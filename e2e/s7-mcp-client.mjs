// S7 冒烟:真实 MCP SDK 客户端打点控制台 /mcp
// 用法:AW_S7_TOKEN=agt_xxx tsx e2e/s7-mcp-client.mjs [http://127.0.0.1:8787/mcp]
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const token =
  process.env.AW_S7_TOKEN ??
  JSON.parse(readFileSync("/tmp/s7-agent.json", "utf8")).token;
const url = process.argv[2] ?? "http://127.0.0.1:8787/mcp";

function newClient() {
  return new Client({ name: "s7-spike", version: "0.0.1" });
}
function newTransport() {
  return new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
}

function ok(label, detail) {
  console.log(`PASS ${label}${detail === undefined ? "" : ` :: ${detail}`}`);
}
function fail(label, detail) {
  console.log(`FAIL ${label}${detail === undefined ? "" : ` :: ${detail}`}`);
  process.exitCode = 1;
}

// ① initialize 握手(SDK client.connect 自动发送)
let client = newClient();
try {
  await client.connect(newTransport());
  ok("initialize 握手", `server=${client.getServerVersion()?.name}`);
} catch (error) {
  fail("initialize 握手", String(error));
  process.exit();
}

// ② tools/list
const listed = await client.listTools();
const names = listed.tools.map((t) => t.name);
if (
  JSON.stringify(names) ===
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
  ])
) {
  ok("tools/list 11 工具", names.join(","));
} else {
  fail("tools/list 11 工具", names.join(","));
}

// ③ tools/call task_create
let taskId;
try {
  const created = await client.callTool({
    name: "task_create",
    arguments: { title: "S7 冒烟建单", assigner: "s7-spike", project: "s7" },
  });
  const task = JSON.parse(created.content[0].text).task;
  taskId = task.id;
  ok("task_create", `${taskId} assignee=${task.assignee}`);
} catch (error) {
  fail("task_create", String(error));
}

// ④ task_update running(pending→done 不合法)
try {
  const updated = await client.callTool({
    name: "task_update",
    arguments: { task_id: taskId, status: "running" },
  });
  const task = JSON.parse(updated.content[0].text).task;
  ok("task_update running", `status=${task.status}`);
} catch (error) {
  fail("task_update running", String(error));
}

// ⑤ 重复请求:同参数再发一次 task_create(无幂等键语义,记录行为)
const dup = await client.callTool({
  name: "task_create",
  arguments: { title: "S7 冒烟建单", assigner: "s7-spike", project: "s7" },
});
const dupTask = JSON.parse(dup.content[0].text).task;
if (dupTask.id !== taskId) {
  ok("重复请求行为=新建任务(非幂等)", `second=${dupTask.id}`);
} else {
  ok("重复请求行为=幂等去重", `same=${dupTask.id}`);
}

// ⑥ kb_search(候选库为空,返回空数组)
const searched = await client.callTool({ name: "kb_search", arguments: { search: "部署" } });
const hits = JSON.parse(searched.content[0].text).hits;
ok("kb_search", `hits=${hits.length}`);

// ⑦ 断线:长轮询 a2a_inbox wait=10s,5s 后 abort
try {
  const abortClient = newClient();
  await abortClient.connect(newTransport());
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5000);
  const t0 = Date.now();
  await abortClient.callTool(
    { name: "a2a_inbox", arguments: { wait: 10 } },
    undefined,
    { signal: controller.signal },
  );
  ok("a2a_inbox 长轮询提前返回", `${Date.now() - t0}ms`);
} catch (error) {
  ok("a2a_inbox 客户端中断", `${error.name}: ${String(error.message).slice(0, 80)}`);
}

// ⑧ 断线后新连接仍可用(无会话粘性)
try {
  const fresh = newClient();
  await fresh.connect(newTransport());
  const again = await fresh.callTool({ name: "kb_search", arguments: { search: "x" } });
  ok("断线后重连可用", `hits=${JSON.parse(again.content[0].text).hits.length}`);
  await fresh.close();
} catch (error) {
  fail("断线后重连可用", String(error));
}

await client.close();
console.log("DONE");
