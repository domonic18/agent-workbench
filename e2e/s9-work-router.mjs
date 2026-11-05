// S9 联测:确定性 Router + worker_inbox 全链(M3.9-1 第十四刀)
//
// 核心验证:控制台会话触发 API → Git 注册表路由 → Agent Bearer 经 /mcp
// 领取 assignment → 读 Mandate → 建关联任务 → ACK;重放不重复开工;
// 同 Thread 再触发 owner 直通成 input;handback 单事件退回;
// 外部 Agent 领不到别人的 inbox。
//
// 用法(对本地 compose 控制台):
//   AW_S9_PASSWORD=<控制台口令> node e2e/s9-work-router.mjs
// 可选:AW_S9_URL=http://127.0.0.1:8787
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = (process.env.AW_S9_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const password = process.env.AW_S9_PASSWORD;
if (password === undefined || password === "") {
  console.error("需要 AW_S9_PASSWORD(控制台登录口令)");
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
  const headers = { "content-type": "application/json" };
  if (cookie !== undefined) headers.cookie = cookie;
  if (method !== "GET") headers["x-requested-with"] = "fetch";
  if (key !== undefined) headers["idempotency-key"] = key;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    headers: res.headers,
    body: await res.json().catch(() => null),
  };
}

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

// ② 注册/复用试点 workbuddy Agent(key=workbuddy-pilot,注册表路由目标)
let pilot = await api("/api/agents", {
  method: "POST",
  cookie,
  key: `s9-reg-${runId}`,
  body: {
    runtime: "workbuddy",
    key: PROJECT,
    project: PROJECT,
    displayName: "S9 Pilot WorkBuddy",
  },
});
let wbToken;
if (pilot.status === 201) {
  wbToken = pilot.body.secret;
  ok("注册试点 Agent", `id=${pilot.body.agent.id} key=${pilot.body.agent.key}`);
} else if (pilot.status === 409) {
  const list = await api(`/api/agents?limit=200`, { cookie });
  const found = (list.body.items ?? []).find((a) => a.key === PROJECT);
  if (found === undefined) {
    fail("复用试点 Agent", `注册 409 但列表未找到 key=${PROJECT}`);
    process.exit(1);
  }
  const rotated = await api(`/api/agents/${found.id}/rotate`, {
    method: "POST",
    cookie,
    key: `s9-rot-${runId}`,
  });
  wbToken = rotated.body.secret;
  ok("复用试点 Agent(轮换密钥)", `id=${found.id}`);
} else {
  fail("注册试点 Agent", `status=${pilot.status} ${JSON.stringify(pilot.body)}`);
  process.exit(1);
}

// ③ 外部 Agent(无 key,验证领不到别人的 inbox)
const outsider = await api("/api/agents", {
  method: "POST",
  cookie,
  key: `s9-out-${runId}`,
  body: { runtime: "codex", project: "s9-outsider", displayName: "S9 Outsider" },
});
if (outsider.status !== 201) {
  fail("注册外部 Agent", `status=${outsider.status}`);
  process.exit(1);
}
const outToken = outsider.body.secret;

function trigger(eventId, extra = {}) {
  return api("/api/work/triggers", {
    method: "POST",
    cookie,
    key: `s9-trg-${eventId}`,
    body: {
      source: "bug",
      sourceEventId: `s9-${runId}-${eventId}`,
      kind: "submitted",
      occurredAt: Date.now(),
      actor: { suite: "s9" },
      project: PROJECT,
      threadRefs: [{ source: "bug", externalKind: "issue", externalKey: `s9-${runId}` }],
      payload: { title: `S9 联测 ${runId}:${eventId}` },
      refs: [],
      ...extra,
    },
  });
}

// ④ 首次触发:注册表唯一命中 → routed + assignment
const t1 = await trigger("t1");
const routed = t1.body?.trigger;
assert(
  t1.status === 200 && routed?.disposition === "routed" && t1.body.inboxIds.length === 1,
  "触发 routed 到试点 Agent",
  `disposition=${routed?.disposition} item=${t1.body?.workItem?.id} inbox=${t1.body?.inboxIds?.length}`,
);
const workItemId = t1.body.workItem.id;

// ⑤ Agent Bearer 连 /mcp:tools/list 11 工具
function mcpClient(token, name) {
  return new Client({ name, version: "0.0.1" }).connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
}
const wb = await mcpClient(wbToken, "s9-workbuddy");
const tools = (await wb.listTools()).tools.map((t) => t.name);
assert(
  JSON.stringify(tools) ===
    JSON.stringify([
      "task_create",
      "task_update",
      "a2a_send",
      "a2a_inbox",
      "a2a_ack",
      "kb_search",
      "kb_write",
      "work_inbox",
      "work_read",
      "work_ack",
      "work_handback",
    ]),
  "tools/list 11 工具",
  tools.join(","),
);

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? "{}";
  if (result.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
}

// ⑥ 领取 assignment(按本次事项过滤,容忍历史残留行)
const inbox1 = await call(wb, "work_inbox", { wait: 5 });
const assignment = (inbox1.inbox ?? []).find(
  (row) => row.kind === "assignment" && row.work_item_id === workItemId,
);
assert(assignment !== undefined && assignment.work_item_id === workItemId, "领取 assignment",
  `inbox=${assignment?.inbox_id} lease_until=${assignment?.lease_until}`);

// ⑦ 读 Mandate
const detail = await call(wb, "work_read", { work_item_id: workItemId });
assert(
  typeof detail.work_item?.expected_result === "string" &&
    detail.work_item.expected_result.includes("PR"),
  "work_read 读到 Mandate",
  `expected=${detail.work_item?.expected_result?.slice(0, 24)}…`,
);

// ⑧ 建承接任务(origin=work_item)并 ACK
const created = await call(wb, "task_create", {
  title: `S9 承接 ${workItemId}`,
  assigner: "s9-e2e",
  project: PROJECT,
  work_item_id: workItemId,
});
assert(created.task?.origin === "work_item", "task_create 关联事项",
  `task=${created.task?.id} origin=${created.task?.origin}`);
await call(wb, "work_ack", { inbox_id: assignment.inbox_id, task_id: created.task.id });
ok("work_ack 绑定承接任务", `task=${created.task.id}`);

// ⑨ 重放同一触发:不重复开工
const replay = await trigger("t1");
assert(
  replay.body?.replayed === true && replay.body.inboxIds.length === 0 &&
    replay.body.trigger.work_item_id === workItemId,
  "重复触发不重复建",
  `replayed=${replay.body?.replayed}`,
);

// ⑩ 同 Thread 新事件:owner 直通成 input
const t2 = await trigger("t2");
assert(
  t2.body?.trigger?.disposition === "continued" && t2.body.inboxIds.length === 1,
  "同 Thread 再触发 owner 直通 input",
  `disposition=${t2.body?.trigger?.disposition}`,
);
const inbox2 = await call(wb, "work_inbox", { wait: 5 });
const input = (inbox2.inbox ?? []).find(
  (row) => row.kind === "input" && row.trigger_id === t2.body.trigger.id,
);
assert(input !== undefined, "领取 input", `inbox=${input?.inbox_id}`);

// ⑪ handback 单事件退回
await call(wb, "work_handback", { inbox_id: input.inbox_id, reason: "S9 验证单事件退回" });
ok("work_handback 退回 input", input.inbox_id);

// ⑫ 再来一条 input 消费掉(assignment 仍活跃,owner 不变)
const t3 = await trigger("t3");
assert(t3.body?.trigger?.disposition === "continued", "owner 保持直通", `t3=${t3.body?.trigger?.disposition}`);
const inbox3 = await call(wb, "work_inbox", { wait: 5 });
const input3 = (inbox3.inbox ?? []).find(
  (row) => row.kind === "input" && row.trigger_id === t3.body.trigger.id,
);
if (input3 !== undefined) {
  await call(wb, "work_ack", { inbox_id: input3.inbox_id });
  ok("input ACK 消费", input3.inbox_id);
} else {
  fail("input ACK 消费", "未领取到 input");
}

// ⑬ 外部 Agent 领不到别人的 inbox
const out = await mcpClient(outToken, "s9-outsider");
const outInbox = await call(out, "work_inbox", { wait: 0 });
assert((outInbox.inbox ?? []).length === 0, "外部 Agent 领不到别人 inbox",
  `rows=${outInbox.inbox?.length}`);

await wb.close();
await out.close();
console.log(process.exitCode === 1 ? "S9 FAILED" : "DONE");
