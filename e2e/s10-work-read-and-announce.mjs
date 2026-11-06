// S10 联测:work-items 读侧 API + A2A 协作播报端到端
//
// 核心验证:
//  A. 读侧 API(arch/01 §4):触发产生事项后,GET /api/work-items 列表过滤/游标翻页、
//     /api/work-items/:id 详情(Mandate 快照 + 投递箱 + Thread 关联)、
//     /api/work-items/:id/events seq 游标增量;
//  B. A2A 协作播报链:A 建任务 → a2a_send(任务开始〔交接〕)→ B 收信建承接任务 →
//     a2a_ack(任务接收〔接单〕)→ B 推进 done(任务完成〔完成〕),
//     断言四条协作播报(交接/接单/完成/验收)进入发件箱并投递到飞书协作群(delivered)。
//
// 前置:本地 compose 栈(docker exec 查 outbox)、容器已配置 FEISHU_COLLAB_CHAT_ID,
//      否则播报不入队,脚本会在前置检查处失败并说明。
//
// 用法:
//   AW_S10_PASSWORD=<控制台口令> node e2e/s10-work-read-and-announce.mjs
// 可选:AW_S10_URL=http://127.0.0.1:8787 AW_S10_PG_CONTAINER=agent-workbench-postgres-1
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createAgentCleaner, reportCleanup } from "./lib/cleanup.mjs";

const base = (process.env.AW_S10_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const pgContainer = process.env.AW_S10_PG_CONTAINER ?? "agent-workbench-postgres-1";
const consoleContainer = process.env.AW_S10_CONSOLE_CONTAINER ?? "agent-workbench-console-1";
const password = process.env.AW_S10_PASSWORD;
if (password === undefined || password === "") {
  console.error("需要 AW_S10_PASSWORD(控制台登录口令)");
  process.exit(2);
}
const runId = Date.now().toString(36);
const PROJECT = "workbuddy-pilot";

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

async function api(path, { method = "GET", cookie, body, key } = {}) {
  // content-type 只在有 body 时带:无 body 的 POST 带 json 头会被 Fastify 400
  const headers = {};
  if (cookie !== undefined) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["x-requested-with"] = "fetch";
  if (key !== undefined) headers["idempotency-key"] = key;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", pgContainer, "psql", "-U", "agent_workbench", "-d", "agent_workbench", "-tAc", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

function bulletinRow(idempotencyKey) {
  const row = psql(
    `SELECT status FROM outbox WHERE kind='collab_bulletin' AND idempotency_key='${idempotencyKey}' LIMIT 1`,
  );
  return row === "" ? null : row;
}

// 发件箱投递是异步的,轮询等 sender 把协作播报推到飞书;终态 delivered
async function awaitBulletinSent(idempotencyKey, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const TERMINAL_BAD = new Set(["failed", "uncertain"]);
  while (Date.now() < deadline) {
    const row = bulletinRow(idempotencyKey);
    if (row === "delivered") return "delivered";
    if (row !== null && TERMINAL_BAD.has(row)) return row; // failed/uncertain 提前返回
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return bulletinRow(idempotencyKey);
}

// ── 前置:协作群必须已配置,否则播报链整条无意义 ──────────────────────────
const collabConfigured = execFileSync(
  "docker",
  ["exec", consoleContainer, "printenv", "FEISHU_COLLAB_CHAT_ID"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
).trim();
if (collabConfigured === "") {
  fail("前置检查", "容器未配置 FEISHU_COLLAB_CHAT_ID,协作播报不会入队");
  process.exit(1);
}
ok("前置检查", `协作群已配置(${collabConfigured.slice(0, 8)}…)`);

// ① 控制台会话登录
const login = await api("/api/auth/login", { method: "POST", body: { password } });
if (login.status !== 200) {
  fail("控制台登录", `status=${login.status}`);
  process.exit(1);
}
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (cookie === undefined) {
  fail("控制台登录", "响应没有 set-cookie");
  process.exit(1);
}
ok("控制台登录", "session ok");

// 收尾清理:本次建出的 Agent 跑完即删,不在库里留垃圾
const cleaner = createAgentCleaner({ base, cookie, keyPrefix: `s10-cleanup-${runId}` });

// 路由注册表:派工要按 key 命中一个在册 Agent,先建一个 key=workbuddy-pilot 的试点 Agent
const pilot = await api("/api/agents", {
  method: "POST",
  cookie,
  key: `s10-pilot-${runId}`,
  body: {
    runtime: "workbuddy",
    key: PROJECT,
    project: PROJECT,
    displayName: "S10 Pilot WorkBuddy",
  },
});
if (pilot.status === 201) {
  cleaner.track(pilot.body.agent.id);
  ok("注册路由试点 Agent", `id=${pilot.body.agent.id}`);
} else if (pilot.status === 409) {
  const list = await api(`/api/agents?limit=200`, { cookie });
  const found = (list.body.items ?? []).find((a) => a.key === PROJECT);
  if (found === undefined) {
    fail("复用路由试点 Agent", "注册 409 但列表未找到 key=" + PROJECT);
    reportCleanup(await cleaner.run());
    process.exit(1);
  }
  ok("复用路由试点 Agent", `id=${found.id}`);
} else {
  fail("注册路由试点 Agent", `status=${pilot.status}`);
  reportCleanup(await cleaner.run());
  process.exit(1);
}

// ── Part A:work-items 读侧 API ──────────────────────────────────────────
// ② 触发一条新事项(注册表路由到试点 Agent,只读断言不领取)
const t1 = await api("/api/work/triggers", {
  method: "POST",
  cookie,
  key: `s10-trg-${runId}`,
  body: {
    source: "bug",
    sourceEventId: `s10-${runId}-t1`,
    kind: "submitted",
    occurredAt: Date.now(),
    actor: { suite: "s10" },
    project: PROJECT,
    threadRefs: [{ source: "bug", externalKind: "issue", externalKey: `s10-${runId}` }],
    payload: { title: `S10 读侧联测 ${runId}` },
    refs: [],
  },
});
const workItemId = t1.body?.workItem?.id;
assert(
  t1.status === 200 && t1.body?.trigger?.disposition === "routed" && workItemId !== undefined,
  "触发 routed 产生事项",
  `item=${workItemId}`,
);

// ③ 列表:项目过滤命中 + 游标翻页
const list = await api(`/api/work-items?project=${PROJECT}&limit=50`, { cookie });
const listed = (list.body?.items ?? []).find((item) => item.id === workItemId);
assert(list.status === 200 && listed !== undefined, "列表含新事项(项目过滤)", `items=${list.body?.items?.length}`);
assert(
  listed !== undefined && listed.kind === "bug_fix" && listed.stage === "intake" && listed.attention === "none",
  "列表条目带投影列",
  `kind=${listed?.kind} stage=${listed?.stage} attention=${listed?.attention}`,
);
const noAuth = await api("/api/work-items", {});
assert(noAuth.status === 401, "列表未登录 401", `status=${noAuth.status}`);
const badFilter = await api("/api/work-items?stage=whatever", { cookie });
assert(badFilter.status === 422, "非法枚举过滤 422", `status=${badFilter.status}`);

// ④ 详情:Mandate 快照 + 投递箱 + Thread 关联
const detail = await api(`/api/work-items/${workItemId}`, { cookie });
const d = detail.body?.workItem;
assert(
  detail.status === 200 && typeof d?.expectedResult === "string" && d.expectedResult.includes("PR") &&
    d.scope !== undefined && /^[0-9a-f]{12}$/.test(d.policyVersion ?? ""),
  "详情含 Mandate 快照",
  `policy=${d?.policyVersion}`,
);
assert(
  (detail.body?.inbox ?? []).some(
    (row) => row.kind === "assignment" && row.status === "pending",
  ),
  "详情含待领取 assignment",
);
assert(
  (detail.body?.threads ?? []).some(
    (row) => row.externalKey === `s10-${runId}` && row.mode === "owner",
  ),
  "详情含 Thread owner 关联",
);
const missing = await api("/api/work-items/wim_missing", { cookie });
assert(missing.status === 404, "未知事项 404", `status=${missing.status}`);

// ⑤ 事件时间线:routed 事件 + seq 游标增量
const events = await api(`/api/work-items/${workItemId}/events`, { cookie });
const evItems = events.body?.items ?? [];
assert(
  events.status === 200 && evItems.length >= 2 && evItems[0]?.kind === "routed",
  "事件时间线含 routed",
  `events=${evItems.length} first=${evItems[0]?.kind}`,
);
const page1 = await api(`/api/work-items/${workItemId}/events?limit=1`, { cookie });
const p1 = page1.body;
assert(
  page1.status === 200 && p1.items.length === 1 && p1.nextCursor === p1.items[0].seq,
  "事件分页 limit=1 带游标",
  `nextCursor=${p1?.nextCursor}`,
);
const page2 = await api(`/api/work-items/${workItemId}/events?cursor=${p1.nextCursor}`, { cookie });
assert(
  page2.status === 200 &&
    page2.body.items.length === evItems.length - 1 &&
    page2.body.items.every((e) => e.seq > p1.items[0].seq),
  "事件游标增量不重复",
  `page2=${page2.body?.items?.length}`,
);

// ── Part B:A2A 协作播报链(任务开始/接收/完成 → 飞书协作群) ───────────────
// ⑥ 注册 A(白名单指向 B)与 B
const regB = await api("/api/agents", {
  method: "POST",
  cookie,
  key: `s10-b-${runId}`,
  body: { runtime: "codex", project: `s10-b-${runId}`, displayName: "S10 Worker B" },
});
assert(regB.status === 201, "注册下游 Agent B", `id=${regB.body?.agent?.id}`);
if (regB.status === 201) cleaner.track(regB.body.agent.id);
const regA = await api("/api/agents", {
  method: "POST",
  cookie,
  key: `s10-a-${runId}`,
  body: {
    runtime: "codex",
    project: `s10-a-${runId}`,
    displayName: "S10 Sender A",
    allowedTargets: [regB.body.agent.id],
  },
});
assert(regA.status === 201, "注册发送方 Agent A(白名单含 B)", `id=${regA.body?.agent?.id}`);
if (regA.status === 201) cleaner.track(regA.body.agent.id);
if (process.exitCode === 1) {
  reportCleanup(await cleaner.run());
  process.exit(1);
}

function mcpClient(token, name) {
  const client = new Client({ name, version: "0.0.1" });
  return client
    .connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    )
    .then(() => client);
}
async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? "{}";
  if (result.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
}
const a = await mcpClient(`${regA.body.agent.id}.${regA.body.secret}`, "s10-a");
const b = await mcpClient(`${regB.body.agent.id}.${regB.body.secret}`, "s10-b");

// ⑦ A 建任务并 a2a_send → 任务开始〔交接〕
const taskA = await call(a, "task_create", {
  title: `S10 上游 ${runId}`,
  assigner: "s10-e2e",
  project: `s10-a-${runId}`,
});
const sent = await call(a, "a2a_send", {
  task_id: taskA.task.id,
  to: regB.body.agent.id,
  intent: "request",
  summary: `S10 协作播报联测 ${runId}`,
  expect: "完成读侧断言并回执",
  deadline: new Date(Date.now() + 3_600_000).toISOString(),
});
const msgId = sent.msg_id;
ok("a2a_send 任务开始", `msg=${msgId}`);
const handoffState = await awaitBulletinSent(`collab:${msgId}`);
assert(handoffState === "delivered", "〔交接〕播报已投递协作群", `status=${handoffState}`);

// ⑧ B 收信、建承接任务、a2a_ack → 任务接收〔接单〕
const inboxB = await call(b, "a2a_inbox", { wait: 5 });
const received = (inboxB.items ?? []).find((m) => m.msg_id === msgId);
assert(received !== undefined, "B 收到 A2A 消息", `msg=${msgId}`);
const taskB = await call(b, "task_create", {
  title: `S10 承接 ${runId}`,
  assigner: "s10-e2e",
  project: `s10-b-${runId}`,
});
await call(b, "a2a_ack", { msg_id: msgId, task_id: taskB.task.id });
ok("a2a_ack 任务接收", `task=${taskB.task.id}`);
const acceptState = await awaitBulletinSent(`collab:a2a:ack:${msgId}`);
assert(acceptState === "delivered", "〔接单〕播报已投递协作群", `status=${acceptState}`);

// ⑨ B 推进 running → done → 任务完成〔完成〕
await call(b, "task_update", { task_id: taskB.task.id, status: "running" });
await call(b, "task_update", { task_id: taskB.task.id, status: "done", output: "https://example.com/s10" });
ok("task_update 推进 done", `task=${taskB.task.id}`);
const doneState = await awaitBulletinSent(`collab:task_done:${taskB.task.id}`);
assert(doneState === "delivered", "〔完成〕播报已投递协作群", `status=${doneState}`);

// ⑩ 根任务收口产生〔验收〕(下游终态且回执已确认,系统自动收口)
const closedState = await awaitBulletinSent(`collab:task_closed:${taskA.task.id}`, { timeoutMs: 15_000 });
assert(closedState === "delivered", "〔验收〕播报已投递协作群", `status=${closedState}`);

await a.close();
await b.close();
reportCleanup(await cleaner.run());
console.log(process.exitCode === 1 ? "S10 FAILED" : "DONE");
