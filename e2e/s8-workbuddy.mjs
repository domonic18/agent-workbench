// S8 联调:机器无关(无 aw-node)WorkBuddy Agent 注册 + /mcp 长轮询 + 重复 tick 去重
//
// 核心验证(M3.8-3 第六刀):无 aw-node 的外部运行时也能注册为 Agent(machine_id=NULL)、
// 直接拿 Agent Bearer 打 /mcp 拉 a2a_inbox 处理消息;ACK 后重复 tick 不再重复投递。
//
// 用法:
//   AW_S8_URL=http://127.0.0.1:8787 node e2e/s8-workbuddy.mjs
//
// 可选闭环(由真实 WorkBuddy 运行时接管时):先在控制台把本脚本注册的 workbuddy Agent 加入某个
// 发送方 Agent 的委派白名单,并准备好该发送方名下任务,再传入:
//   AW_S8_SENDER_TOKEN=<发送方 Bearer> AW_S8_TASK_ID=<发送方名下任务> node e2e/s8-workbuddy.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = (process.env.AW_S8_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const mcpUrl = `${base}/mcp`;
const senderToken = process.env.AW_S8_SENDER_TOKEN ?? null;
const senderTaskId = process.env.AW_S8_TASK_ID ?? null;

function ok(label, detail) {
  console.log(`PASS ${label}${detail === undefined ? "" : ` :: ${detail}`}`);
}
function fail(label, detail) {
  console.log(`FAIL ${label}${detail === undefined ? "" : ` :: ${detail}`}`);
  process.exitCode = 1;
}
function assert(cond, label, detail) {
  if (cond) ok(label, detail);
  else fail(label, detail);
}

function transport(token) {
  return new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
}

async function registerWorkbuddy(displayName) {
  const res = await fetch(`${base}/api/agents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "fetch",
      "idempotency-key": `s8-${displayName}-${Date.now()}`,
    },
    body: JSON.stringify({ project: "s8-wb", displayName, runtime: "workbuddy" }),
  });
  return { status: res.status, body: await res.json() };
}

// ① 注册机器无关 workbuddy Agent(无 machineId)
const reg = await registerWorkbuddy("S8 WorkBuddy");
assert(
  reg.status === 201 &&
    reg.body.agent !== undefined &&
    reg.body.agent.machineId === null &&
    reg.body.agent.runtime === "workbuddy",
  "注册机器无关 workbuddy Agent",
  `status=${reg.status} id=${reg.body.agent?.id} machineId=${reg.body.agent?.machineId} runtime=${reg.body.agent?.runtime}`,
);
if (process.exitCode !== undefined) process.exit(process.exitCode);
const wbToken = reg.body.secret;

// ② 以 workbuddy 身份连 /mcp,tools/list
const client = new Client({ name: "s8-workbuddy", version: "0.0.1" });
await client.connect(transport(wbToken));
const toolNames = (await client.listTools()).tools.map((t) => t.name);
ok("workbuddy /mcp tools/list", toolNames.join(","));

// ③ 空信箱长轮询:应空手返回,不报错(证明机器无关 Agent 是合格的 MCP 客户端)
const empty = await client.callTool({ name: "a2a_inbox", arguments: { wait: 2 } });
const emptyItems = JSON.parse(empty.content[0].text).items ?? [];
assert(emptyItems.length === 0, "workbuddy a2a_inbox 空轮询", `items=${emptyItems.length}`);

// ④ 可选闭环:发送 → 轮询 → ACK → 重复 tick 去重
if (senderToken !== null && senderTaskId !== null) {
  const sender = new Client({ name: "s8-sender", version: "0.0.1" });
  await sender.connect(transport(senderToken));

  const sent = await sender.callTool({
    name: "a2a_send",
    arguments: {
      task_id: senderTaskId,
      to: reg.body.agent.id,
      intent: "request",
      summary: "S8 联调请求",
      expect: "回执",
    },
  });
  const sentMsgId = JSON.parse(sent.content[0].text).msgId;
  ok("发送方 a2a_send", `msg=${sentMsgId}`);

  const first = await client.callTool({ name: "a2a_inbox", arguments: { wait: 5 } });
  const firstItems = JSON.parse(first.content[0].text).items ?? [];
  const received = firstItems.find((m) => m.msg_id === sentMsgId);
  assert(received !== undefined, "workbuddy 轮询收到消息", `msg=${sentMsgId}`);
  if (process.exitCode !== undefined) {
    await client.close();
    process.exit(process.exitCode);
  }

  const ack = await client.callTool({
    name: "a2a_ack",
    arguments: { msg_id: received.msg_id, task_id: senderTaskId },
  });
  assert(JSON.parse(ack.content[0].text).ok === true, "workbuddy a2a_ack", received.msg_id);

  // 重复 tick:ACK 后再次轮询,同一条消息不应再投递(去重由 inbox 协议保证)
  const second = await client.callTool({ name: "a2a_inbox", arguments: { wait: 2 } });
  const secondItems = JSON.parse(second.content[0].text).items ?? [];
  const redelivered = secondItems.some((m) => m.msg_id === sentMsgId);
  assert(!redelivered, "重复 tick 不重复投递", `secondItems=${secondItems.length}`);

  await sender.close();
} else {
  console.log(
    "SKIP 发送→ACK→去重闭环:未提供 AW_S8_SENDER_TOKEN / AW_S8_TASK_ID",
  );
  console.log(
    "      预置步骤:在控制台把本脚本注册的 workbuddy Agent 加入某发送方 Agent 的委派白名单,",
  );
  console.log("      再带发送方 Bearer 与其名下任务重跑即可跑通完整闭环。真实 WorkBuddy 运行时实测随 S9。");
}

await client.close();
console.log("DONE");
