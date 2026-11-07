// M4-1 联测:用量上限与硬停(控制面 API + /mcp 真实调用)
//
// 核心验证:
//   ① 机器绑定 Agent 走真实采集链路(/api/ingest 推 token_usage)→ 设上限后
//      /mcp 控制工具被拒,审计落 deny;
//   ② 机器无关 Agent(路由注册表里的 pilot)用量用尽 → 新工作事项派工改走
//      needs_person / target_token_exhausted,不建事项不投 inbox;
//   ③ hard_stop=false 只计量不拦截、is_active=false 整行停用即无限量,均能恢复。
//
// 用法(对本地 compose 控制台):
//   AW_M41_PASSWORD=<控制台口令> node e2e/m41-usage-limit.mjs
// 可选:AW_M41_URL=http://127.0.0.1:8799
//      AW_M41_DATABASE_URL=postgres://…(② 需要直写一条 token_usage 造用量,
//      因为机器无关 Agent 无采集归属路径;等价于 M4-1 计划里的「手动插入 token_usage」;
//      同时用于收尾删掉本次建的测试机器行,缺省则机器行保留)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import pg from "pg";
import { createAgentCleaner, reportCleanup } from "./lib/cleanup.mjs";

const base = (process.env.AW_M41_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const password = process.env.AW_M41_PASSWORD;
if (password === undefined || password === "") {
  console.error("需要 AW_M41_PASSWORD(控制台登录口令)");
  process.exit(2);
}
const databaseUrl = process.env.AW_M41_DATABASE_URL;
const runId = Date.now().toString(36);
const PROJECT = "workbuddy-pilot";
const MACHINE = `m41-${runId}`;
const DAILY_LIMIT = 100;

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

async function api(path, { method = "GET", cookie, body, key, bearer } = {}) {
  // content-type 只在有 body 时带:无 body 的 POST 带 json 头会被 Fastify 400
  const headers = {};
  if (cookie !== undefined) headers.cookie = cookie;
  if (bearer !== undefined) headers.authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers["content-type"] = "application/json";
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

// 收尾清理:本次建出的 Agent 跑完即删,不在库里留垃圾
const cleaner = createAgentCleaner({ base, cookie, keyPrefix: `m41-cleanup-${runId}` });

/**
 * 删本次建的测试机器行:机器表对 agent_run / ingest_receipt 是 RESTRICT,
 * 先清引用再删本体。没有机器删除路由,只能直写库。
 */
async function cleanupMachine() {
  if (databaseUrl === undefined || databaseUrl === "") {
    console.log(`SKIP 机器行清理:${MACHINE}(未提供 AW_M41_DATABASE_URL)`);
    return;
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      `DELETE FROM timeline_event WHERE run_id IN (SELECT id FROM agent_run WHERE machine = $1)`,
      [MACHINE],
    );
    await pool.query(
      `DELETE FROM token_usage WHERE run_id IN (SELECT id FROM agent_run WHERE machine = $1)`,
      [MACHINE],
    );
    await pool.query("DELETE FROM agent_run WHERE machine = $1", [MACHINE]);
    await pool.query("DELETE FROM ingest_receipt WHERE collector_id = $1", [MACHINE]);
    await pool.query("DELETE FROM machine WHERE id = $1", [MACHINE]);
    console.log(`CLEANUP 已删除机器 ${MACHINE}`);
  } catch (error) {
    console.log(`CLEANUP 机器清理失败 ${MACHINE} :: ${error.message}`);
  } finally {
    await pool.end();
  }
}

/** Agent + 机器一起收尾 */
async function cleanupAll() {
  reportCleanup(await cleaner.run());
  await cleanupMachine();
}

// ② 机器 + 机器绑定 Agent(采集归属目标)
const machine = await api("/api/machines", {
  method: "POST",
  cookie,
  key: `m41-machine-${runId}`,
  body: { id: MACHINE, hostname: "m41-verify", os: "darwin", collectorVersion: "1" },
});
if (machine.status !== 201) {
  fail("登记机器", `status=${machine.status} ${JSON.stringify(machine.body)}`);
  process.exit(1);
}
const collectorToken = `${MACHINE}.${machine.body.secret}`;

const collector = await api("/api/agents", {
  method: "POST",
  cookie,
  key: `m41-agent-collector-${runId}`,
  body: {
    machineId: MACHINE,
    runtime: "claude_code",
    project: PROJECT,
    displayName: "M4-1 Collector Agent",
  },
});
if (collector.status !== 201) {
  fail("注册机器绑定 Agent", `status=${collector.status} ${JSON.stringify(collector.body)}`);
  await cleanupAll();
  process.exit(1);
}
const collectorAgentId = collector.body.agent.id;
const collectorAgentToken = `${collectorAgentId}.${collector.body.secret}`;
cleaner.track(collectorAgentId);

// ③ 机器无关 Agent:路由注册表 workbuddy-pilot.primary 指向它的 key
const pilot = await api("/api/agents", {
  method: "POST",
  cookie,
  key: `m41-agent-pilot-${runId}`,
  body: {
    runtime: "workbuddy",
    key: PROJECT,
    project: PROJECT,
    displayName: "M4-1 Pilot Agent",
  },
});
let pilotId;
let pilotToken;
if (pilot.status === 201) {
  pilotId = pilot.body.agent.id;
  pilotToken = `${pilotId}.${pilot.body.secret}`;
  cleaner.track(pilotId);
} else if (pilot.status === 409) {
  // key 已被上一轮占用:复用该 Agent 并轮换密钥
  const list = await api("/api/agents?limit=200", { cookie });
  const found = (list.body.items ?? []).find((a) => a.key === PROJECT);
  if (found === undefined) {
    fail("复用 pilot Agent", "注册 409 但列表未找到 key=" + PROJECT);
    await cleanupAll();
    process.exit(1);
  }
  const rotated = await api(`/api/agents/${found.id}/rotate`, {
    method: "POST",
    cookie,
    key: `m41-rot-${runId}`,
  });
  pilotId = found.id;
  pilotToken = `${pilotId}.${rotated.body.secret}`;
} else {
  fail("注册 pilot Agent", `status=${pilot.status} ${JSON.stringify(pilot.body)}`);
  await cleanupAll();
  process.exit(1);
}
ok("注册机器与两个 Agent", `collector=${collectorAgentId} pilot=${pilotId}`);

// ④ 采集推真实 token_usage:四维之和 120 > 上限 100
const ingest = await api("/api/ingest", {
  method: "POST",
  bearer: collectorToken,
  body: {
    collector_id: MACHINE,
    agent_project: PROJECT,
    stream_id: `m41-session-${runId}`,
    batch: [
      {
        seq: 1,
        kind: "token_usage",
        occurred_at: Date.now(),
        payload: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          input_tokens: 60,
          output_tokens: 60,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
        },
      },
    ],
    sent_at: Date.now(),
  },
});
assert(
  ingest.status === 200 && ingest.body.acked_seq === 1,
  "采集推 token_usage 入账",
  `status=${ingest.status} acked=${ingest.body?.acked_seq}`,
);

// ⑤ 给采集 Agent 设上限 → /mcp 控制工具被拒(即便 L0 只读)
const limit = await api(`/api/agents/${collectorAgentId}/usage-limit`, {
  method: "PUT",
  cookie,
  key: `m41-limit-${runId}`,
  body: { dailyTokenLimit: DAILY_LIMIT },
});
assert(
  limit.status === 200 &&
    limit.body.agent.usageLimit?.dailyTokenLimit === DAILY_LIMIT &&
    limit.body.agent.usageLimit?.hardStop === true,
  "PUT usage-limit 设上限",
  `status=${limit.status} dto=${JSON.stringify(limit.body?.agent?.usageLimit)}`,
);

async function mcpClient(token, name) {
  const client = new Client({ name, version: "0.0.1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}
async function callKbSearch(client) {
  const result = await client.callTool({ name: "kb_search", arguments: { search: "部署" } });
  return { isError: result.isError === true, text: result.content?.[0]?.text ?? "" };
}

const collectorClient = await mcpClient(collectorAgentToken, "m41-collector");
const denied = await callKbSearch(collectorClient);
assert(
  denied.isError && denied.text.includes("已用尽"),
  "超限后 /mcp 工具调用被拒",
  `text=${denied.text.slice(0, 80)}`,
);
await collectorClient.close();

// ⑥ 给 pilot Agent 造当日用量(机器无关 Agent 无采集归属,直写 token_usage)
if (databaseUrl === undefined || databaseUrl === "") {
  fail("直写 token_usage 缺 AW_M41_DATABASE_URL", "跳过派工硬停验证");
} else {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const runIdRow = `m41-run-${runId}`;
  await pool.query(
    `INSERT INTO agent_run (id, agent_id, machine, project, stream_id, status, started_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, 'running', $6, $6)`,
    [runIdRow, pilotId, MACHINE, PROJECT, `m41-pilot-${runId}`, Date.now()],
  );
  await pool.query(
    `INSERT INTO token_usage
       (id, agent_id, task_id, run_id, provider, model, input_tokens, output_tokens,
        cache_read_tokens, cache_creation_tokens, source, sequence, receipt_hash, occurred_at)
     VALUES ($1, $2, NULL, $3, 'anthropic', 'claude-sonnet-4-6', 60, 60, 0, 0, 'transcript', 1, $4, $5)`,
    [`m41-tu-${runId}`, pilotId, runIdRow, `m41-hash-${runId}`, Date.now()],
  );
  await pool.end();
  ok("直写 token_usage 造当日用量", "120 tokens");
}

// ⑦ 新工作事项派工:目标 Agent 用量用尽 → needs_person / target_token_exhausted
async function trigger(tag) {
  return api("/api/work/triggers", {
    method: "POST",
    cookie,
    key: `m41-trg-${runId}-${tag}`,
    body: {
      source: "bug",
      sourceEventId: `m41-${runId}-${tag}`,
      kind: "submitted",
      occurredAt: Date.now(),
      actor: { suite: "m41" },
      project: PROJECT,
      threadRefs: [{ source: "bug", externalKind: "issue", externalKey: `m41-${runId}-${tag}` }],
      payload: { title: `M4-1 联测 ${runId}:${tag}` },
      refs: [],
    },
  });
}

await api(`/api/agents/${pilotId}/usage-limit`, {
  method: "PUT",
  cookie,
  key: `m41-limit-pilot-${runId}`,
  body: { dailyTokenLimit: DAILY_LIMIT },
});
const blocked = await trigger("blocked");
assert(
  blocked.status === 200 &&
    blocked.body.trigger.disposition === "needs_person" &&
    blocked.body.trigger.reasonCode === "target_token_exhausted" &&
    blocked.body.workItem === null &&
    blocked.body.inboxIds.length === 0,
  "派工因目标 token 用尽改走 needs_person",
  `disposition=${blocked.body?.trigger?.disposition} reason=${blocked.body?.trigger?.reasonCode} inbox=${blocked.body?.inboxIds?.length}`,
);

// ⑧ hard_stop=false:只计量不拦截,派工恢复
const soft = await api(`/api/agents/${pilotId}/usage-limit`, {
  method: "PUT",
  cookie,
  key: `m41-limit-soft-${runId}`,
  body: { dailyTokenLimit: DAILY_LIMIT, hardStop: false },
});
assert(
  soft.status === 200 && soft.body.agent.usageLimit?.hardStop === false,
  "改 hardStop=false",
  `status=${soft.status}`,
);
const pilotClient = await mcpClient(pilotToken, "m41-pilot");
const allowed = await callKbSearch(pilotClient);
assert(!allowed.isError, "hardStop=false 后 /mcp 放行", `text=${allowed.text.slice(0, 60)}`);
const routed = await trigger("routed");
assert(
  routed.status === 200 &&
    routed.body.trigger.disposition === "routed" &&
    routed.body.inboxIds.length === 1,
  "hardStop=false 后派工恢复",
  `disposition=${routed.body?.trigger?.disposition} inbox=${routed.body?.inboxIds?.length}`,
);

// ⑨ is_active=false:整行停用即无限量
const off = await api(`/api/agents/${pilotId}/usage-limit`, {
  method: "PUT",
  cookie,
  key: `m41-limit-off-${runId}`,
  body: { dailyTokenLimit: DAILY_LIMIT, isActive: false },
});
assert(
  off.status === 200 && off.body.agent.usageLimit?.isActive === false,
  "停用上限行",
  `status=${off.status}`,
);
const stillAllowed = await callKbSearch(pilotClient);
assert(!stillAllowed.isError, "停用后 /mcp 放行", `text=${stillAllowed.text.slice(0, 60)}`);
await pilotClient.close();

// ⑩ 校验:负数上限 422、不存在的 Agent 404
const bad = await api(`/api/agents/${pilotId}/usage-limit`, {
  method: "PUT",
  cookie,
  key: `m41-limit-bad-${runId}`,
  body: { dailyTokenLimit: -1 },
});
assert(bad.status === 422, "负数上限 422", `status=${bad.status}`);
const missing = await api("/api/agents/agt_missing/usage-limit", {
  method: "PUT",
  cookie,
  key: `m41-limit-missing-${runId}`,
  body: { dailyTokenLimit: 100 },
});
assert(missing.status === 404, "不存在 Agent 404", `status=${missing.status}`);

await cleanupAll();
console.log(process.exitCode === 1 ? "M4-1 FAILED" : "DONE");
