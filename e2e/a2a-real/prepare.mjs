// A2A 真机实测装配:控制台侧准备三场景的角色、白名单与接入包
//
// 产出(gitignore 的 out/ 下,含 Bearer 与一次性令牌,不入库):
//   out/s1.json        同机不同 Agent:agent-workbench → bug-triage
//   out/s2.json        同机跨运行时:agent-workbench → 机器无关 WorkBuddy Agent
//   out/s3.json        跨设备:agent-workbench → MacBook 新登记 Agent(--finalize 补齐)
//   out/s3-enroll.txt  MacBook 一次性 enroll 令牌与装机步骤
//
// 用法:
//   node e2e/a2a-real/prepare.mjs            装配 S1/S2 + 签发 S3 enroll token
//   node e2e/a2a-real/prepare.mjs --finalize  MacBook 登记完成后补齐 S3 角色与白名单
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { api, consoleSession, fail, mcpAlive, ok, outDir, publicUrl, writeBundle, writeText } from "./common.mjs";
import { receiverPrompt } from "./prompts.mjs";

const SENDER_KEY = "agent-workbench";
const S1_RECEIVER_KEY = "bug-triage";
const S2_RECEIVER_KEY = "a2a-real-workbuddy";
const S2_PROJECT = "a2a-real";

const finalize = process.argv.includes("--finalize");

const SCENARIOS = {
  s1: {
    title: "读取工作区 CLAUDE.md 并概括",
    task: "读取你工作区根目录的 CLAUDE.md,用不超过 8 行回答这个工作区是做什么的、当前状态如何;该文件不存在则改为列出工作区前 5 个条目",
    expect: "≤8 行中文概括 + 工作区前 5 个条目名",
  },
  s2: {
    title: "报告运行时与可见 MCP 工具",
    task: "报告你的运行时名称与工作区绝对路径,并列出你当前可见的 MCP 工具名",
    expect: "运行时名称 + 工作区绝对路径 + MCP 工具名列表",
  },
  s3: {
    title: "清点工作区并总结一个文件",
    task: "列出你工作区前 10 个条目,并挑其中一个文本文件总结其前 20 行内容",
    expect: "工作区前 10 个条目 + 选中文件前 20 行摘要",
  },
};

async function listAgents(cookie) {
  const res = await api("/api/agents?limit=200", { cookie });
  if (res.status !== 200) {
    throw new Error(`读取 Agent 列表失败 status=${res.status}`);
  }
  return res.body.items ?? [];
}

async function setTargets(cookie, agentId, targets) {
  const res = await api(`/api/agents/${agentId}/targets`, {
    method: "PUT",
    cookie,
    key: `a2a-real-targets-${agentId}-${Date.now().toString(36)}`,
    body: { targets },
  });
  if (res.status !== 200) {
    throw new Error(`配白名单失败 agent=${agentId} status=${res.status}`);
  }
  return res.body.agent;
}

/** 白名单是发送方的名单:发送方须含接收方 */
async function link(cookie, senderId, receiverId) {
  const items = await listAgents(cookie);
  const sender = items.find((item) => item.id === senderId);
  const receiver = items.find((item) => item.id === receiverId);
  if (sender === undefined || receiver === undefined) {
    throw new Error(`配白名单时找不到 Agent sender=${senderId} receiver=${receiverId}`);
  }
  const senderTargets = new Set(sender.allowedTargets ?? []);
  senderTargets.add(receiverId);
  await setTargets(cookie, senderId, [...senderTargets]);
  const receiverTargets = new Set(receiver.allowedTargets ?? []);
  receiverTargets.add(senderId);
  await setTargets(cookie, receiverId, [...receiverTargets]);
}

async function ensureWorkbuddyAgent(cookie) {
  const items = await listAgents(cookie);
  const found = items.find((item) => item.key === S2_RECEIVER_KEY);
  if (found !== undefined) {
    // key 已被占用:密钥只存哈希,取不回;上轮签发的 Bearer 仍有效就复用,否则轮换
    const previous = previousBearer(found.id);
    if (previous !== undefined && (await mcpAlive(previous))) {
      ok("复用既有 WorkBuddy Agent 与仍有效的 Bearer", found.id);
      return { id: found.id, secret: previous.split(".")[1] };
    }
    const rotated = await api(`/api/agents/${found.id}/rotate`, {
      method: "POST",
      cookie,
      key: `a2a-real-rot-${Date.now().toString(36)}`,
    });
    if (rotated.status !== 200) {
      throw new Error(`轮换密钥失败 status=${rotated.status}`);
    }
    ok("复用既有 WorkBuddy Agent 并轮换密钥", found.id);
    return { id: found.id, secret: rotated.body.secret };
  }
  const created = await api("/api/agents", {
    method: "POST",
    cookie,
    key: `a2a-real-wb-${Date.now().toString(36)}`,
    body: {
      runtime: "workbuddy",
      key: S2_RECEIVER_KEY,
      project: S2_PROJECT,
      displayName: "A2A 真机 WorkBuddy",
    },
  });
  if (created.status !== 201) {
    throw new Error(`注册 WorkBuddy Agent 失败 status=${created.status} ${JSON.stringify(created.body)}`);
  }
  ok("注册机器无关 WorkBuddy Agent", created.body.agent.id);
  return { id: created.body.agent.id, secret: created.body.secret };
}

/** 上一轮签发的 WorkBuddy Bearer(密钥只存哈希,只能从本地接入包找回) */
function previousBearer(agentId) {
  const path = join(outDir, "s2.json");
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const bundle = JSON.parse(readFileSync(path, "utf8"));
    return bundle.receiver?.agentId === agentId ? bundle.receiver.bearer : undefined;
  } catch {
    return undefined;
  }
}

function bundleOf(scenario, sender, receiver, extra) {  const spec = SCENARIOS[scenario];
  return {
    scenario,
    title: spec.title,
    task: spec.task,
    expect: spec.expect,
    deadlineMinutes: 30,
    sender,
    receiver,
    mcp: { url: `${publicUrl}/mcp` },
    protocolPrompt: receiverPrompt(),
    ...extra,
  };
}

const session = await consoleSession();
ok("控制台会话", session.source);

const agents = await listAgents(session.cookie);
const sender = agents.find((item) => item.key === SENDER_KEY);
if (sender === undefined) {
  fail("找发起方 Agent", `key=${SENDER_KEY} 不存在`);
  process.exit(1);
}
ok("发起方 Agent", `${sender.id} (${SENDER_KEY})`);

if (finalize) {
  // MacBook 登记后:定位非本机机器,确认其 Agent,再配双向白名单
  const machines = await api("/api/machines?limit=50", { cookie: session.cookie });
  const remote = (machines.body.items ?? []).find((item) => item.id !== sender.machineId);
  if (remote === undefined) {
    fail("定位 MacBook 机器", "只登记了本机;MacBook 需先完成 enroll 与发现上报");
    process.exit(1);
  }
  ok("MacBook 机器", remote.id);
  const discovery = await api("/api/bootstrap/discovery", { cookie: session.cookie });
  const entry = (discovery.body.machines ?? []).find((item) => item.machineId === remote.id);
  const reported = entry?.projects ?? [];
  if (reported.length === 0) {
    fail("读取 MacBook 发现上报", "发现列表为空;确认 aw-node 已上报项目");
    process.exit(1);
  }
  ok("MacBook 上报项目", reported.map((item) => item.name).join(", "));
  // 优先确认尚未确认过的项目;已确认则直接复用既有 Agent
  const pending = reported.find((item) => item.confirmed !== true);
  const project = pending?.name ?? reported[0].name;
  const existing = (await listAgents(session.cookie)).find(
    (item) => item.machineId === remote.id && item.project === project,
  );
  let receiverId = existing?.id;
  if (receiverId === undefined) {
    const confirmed = await api("/api/bootstrap/agents", {
      method: "POST",
      cookie: session.cookie,
      key: `a2a-real-confirm-${Date.now().toString(36)}`,
      body: {
        machineId: remote.id,
        agents: [{ project, displayName: `MacBook ${project}` }],
      },
    });
    if (confirmed.status !== 201) {
      fail("确认 MacBook Agent", `status=${confirmed.status} ${JSON.stringify(confirmed.body)}`);
      process.exit(1);
    }
    receiverId = confirmed.body.agents[0].id;
    ok("MacBook Agent 已确认", receiverId);
  } else {
    ok("复用已确认的 MacBook Agent", receiverId);
  }
  await link(session.cookie, sender.id, receiverId);
  ok("S3 双向白名单已配", `${sender.id} ↔ ${receiverId}`);
  const refreshed = await listAgents(session.cookie);
  const receiver = refreshed.find((item) => item.id === receiverId);
  writeBundle(
    "s3",
    bundleOf("s3", { agentId: sender.id, project: sender.project }, {
      agentId: receiverId,
      project: receiver?.project ?? project,
      runtime: "claude_code",
    }),
  );
  ok("产出接入包", "out/s3.json");
} else {
  // S1:同机不同 Agent
  const s1Receiver = agents.find((item) => item.key === S1_RECEIVER_KEY);
  if (s1Receiver === undefined) {
    fail("找 S1 接收方 Agent", `key=${S1_RECEIVER_KEY} 不存在`);
    process.exit(1);
  }
  await link(session.cookie, sender.id, s1Receiver.id);
  ok("S1 双向白名单已配", `${sender.id} ↔ ${s1Receiver.id}`);
  writeBundle(
    "s1",
    bundleOf("s1", { agentId: sender.id, project: sender.project }, {
      agentId: s1Receiver.id,
      project: s1Receiver.project,
      runtime: s1Receiver.runtime,
    }),
  );

  // S2:同机跨运行时(机器无关 WorkBuddy Agent,无 aw-node 泵,需自行轮询)
  const workbuddy = await ensureWorkbuddyAgent(session.cookie);
  await link(session.cookie, sender.id, workbuddy.id);
  ok("S2 双向白名单已配", `${sender.id} ↔ ${workbuddy.id}`);
  writeBundle(
    "s2",
    bundleOf("s2", { agentId: sender.id, project: sender.project }, {
      agentId: workbuddy.id,
      project: S2_PROJECT,
      runtime: "workbuddy",
      bearer: `${workbuddy.id}.${workbuddy.secret}`,
    }),
  );

  // S3:MacBook 一次性 enroll 令牌(令牌只落 out/,不进命令行与 shell history)
  const enroll = await api("/api/bootstrap/enroll-token", {
    method: "POST",
    cookie: session.cookie,
    key: `a2a-real-enroll-${Date.now().toString(36)}`,
  });
  if (enroll.status !== 201) {
    fail("签发 enroll token", `status=${enroll.status}`);
    process.exit(1);
  }
  ok("签发 MacBook enroll token", `有效至 ${new Date(enroll.body.expiresAt).toISOString()}`);
  writeText(
    "s3-enroll",
    [
      "# S3 MacBook 接入材料(令牌一次性,勿外传)",
      "",
      `enroll token: ${enroll.body.token}`,
      `有效至: ${new Date(enroll.body.expiresAt).toISOString()}`,
      "",
      "## 1. 装 aw-node(GitHub 可达时用官方脚本)",
      `curl -fsSL ${publicUrl}/artifacts/install.sh | bash`,
      "",
      "## 2. GitHub 不可达时:拷贝本机 arm64 二进制",
      "# 从 Mac mini 拷贝 ~/.local/bin/aw-node 到 MacBook 同路径,再执行 enroll",
      "",
      "## 3. enroll(令牌走隐藏输入,不进 shell history)",
      `aw-node enroll --url ${publicUrl}`,
      "# 提示 enroll token 时粘贴上面的令牌",
      "",
      "## 4. 声明 MacBook 上的项目(没有 cc-connect 时用 AW_EXTRA_PROJECTS)",
      "/usr/libexec/PlistBuddy -c \"Add :EnvironmentVariables:AW_EXTRA_PROJECTS string macbook-agent=/绝对路径\" \\",
      "  ~/Library/LaunchAgents/com.agent-workbench.aw-node.plist",
      "launchctl kickstart -k gui/$(id -u)/com.agent-workbench.aw-node",
      "",
      "## 5. 装并登录 claude CLI(aw-node 调度需要)",
      "",
      "## 6. 回到控制台侧执行:node e2e/a2a-real/prepare.mjs --finalize",
    ].join("\n"),
  );

  ok("产出接入包", "out/s1.json out/s2.json out/s3-enroll.txt");
  console.log("");
  console.log("S1 可直接跑:node e2e/a2a-real/send.mjs --scenario s1");
  console.log("S2 需要你在 WorkBuddy 侧挂 MCP 并触发,材料见 out/s2.json 的 bearer 与 protocolPrompt");
  console.log("S3 需要 MacBook 完成后执行 prepare.mjs --finalize");
}

console.log(process.exitCode === 1 ? "PREPARE FAILED" : "DONE");
