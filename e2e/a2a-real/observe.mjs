// A2A 真机实测取证:从控制台库核对六步协议与自动收口
//
// 断言链:
//   ① request 消息送达并被 ACK(round=1、thread_id 非空)
//   ② 接收方建起自己的任务,挂到发起方任务下(parent_task_id),推进到 done 且有结论
//   ③ reply 回执带 thread_id 与 reply_to,并被发起方 ACK
//   ④ 发起方根任务由系统自动收口(task_event 里 actor=system)
//   ⑤ 两侧工具调用都有审计记录
import { assert, ok, query, readBundle } from "./common.mjs";

const scenarioIndex = process.argv.indexOf("--scenario");
const scenario = scenarioIndex === -1 ? "s1" : process.argv[scenarioIndex + 1];
const bundle = readBundle(scenario);
const senderId = bundle.sender.agentId;
const receiverId = bundle.receiver.agentId;

const requests = query(
  `SELECT id, thread_id, task_id, round, intent, ack_at, created_at
     FROM a2a_message
    WHERE from_agent = '${senderId}' AND to_agent = '${receiverId}' AND intent = 'request'
    ORDER BY created_at DESC`,
);
if (requests.length === 0) {
  assert(false, "① request 消息存在", `from=${senderId} to=${receiverId} 未查到`);
  console.log("OBSERVE FAILED");
  process.exit(1);
}
const request = requests[0];
ok("① request 消息", `${request.id} thread=${request.thread_id} task=${request.task_id} round=${request.round}`);
assert(request.round === 1, "① request round=1", `round=${request.round}`);
assert(request.ack_at !== null, "① request 已被接收方 ACK", `ack_at=${request.ack_at}`);

const replies = query(
  `SELECT id, thread_id, reply_to_msg_id, task_id, ack_at
     FROM a2a_message
    WHERE intent = 'reply' AND thread_id = '${request.thread_id}'
    ORDER BY created_at DESC`,
);
if (replies.length === 0) {
  assert(false, "③ reply 回执存在", `thread=${request.thread_id} 未查到`);
  console.log("OBSERVE FAILED");
  process.exit(1);
}
const reply = replies[0];
ok("③ reply 回执", `${reply.id} task=${reply.task_id}`);
assert(reply.thread_id === request.thread_id, "③ reply 沿原 thread", `thread=${reply.thread_id}`);
assert(reply.reply_to_msg_id === request.id, "③ reply 带 reply_to", `reply_to=${reply.reply_to_msg_id}`);
assert(reply.ack_at !== null, "③ reply 已被发起方 ACK", `ack_at=${reply.ack_at}`);

const receiverTasks = query(
  `SELECT id, assignee, parent_task_id, status, output FROM task WHERE id = '${reply.task_id}'`,
);
if (receiverTasks.length === 0) {
  assert(false, "② 接收方任务存在", `task=${reply.task_id}`);
  console.log("OBSERVE FAILED");
  process.exit(1);
}
const receiverTask = receiverTasks[0];
ok("② 接收方任务", `${receiverTask.id} status=${receiverTask.status}`);
assert(receiverTask.assignee === receiverId, "② 接收方任务归属接收方", `assignee=${receiverTask.assignee}`);
assert(
  receiverTask.parent_task_id === request.task_id,
  "② 接收方任务挂到发起方任务下",
  `parent=${receiverTask.parent_task_id}`,
);
assert(receiverTask.status === "done", "② 接收方任务已 done", `status=${receiverTask.status}`);
assert(
  typeof receiverTask.output === "string" && receiverTask.output.length > 0,
  "② 接收方任务有真实结论",
  `output=${(receiverTask.output ?? "").slice(0, 80)}`,
);

const senderTasks = query(
  `SELECT id, assignee, status, output FROM task WHERE id = '${request.task_id}'`,
);
const senderTask = senderTasks[0] ?? { id: null, assignee: null, status: null, output: null };
ok("④ 发起方根任务", `${senderTask.id} status=${senderTask.status}`);
assert(senderTask.assignee === senderId, "④ 根任务归属发起方", `assignee=${senderTask.assignee}`);
assert(senderTask.status === "done", "④ 根任务已收口", `status=${senderTask.status}`);

const autoClose = query(
  `SELECT kind, payload_json FROM task_event
    WHERE task_id = '${request.task_id}' AND payload_json LIKE '%auto_close%'
    ORDER BY occurred_at`,
);
assert(autoClose.length > 0, "④ 根任务由系统自动收口", `事件数=${autoClose.length}`);
for (const event of autoClose) {
  console.log(`   事件 ${event.kind} ${event.payload_json}`);
}

const handoff = query(
  `SELECT kind FROM task_event WHERE task_id = '${reply.task_id}' AND kind = 'handoff'`,
);
assert(handoff.length > 0, "② 接收方任务有 handoff 事件", `事件数=${handoff.length}`);

const logs = query(
  `SELECT agent_id, tool, verdict, reason FROM tool_call_log
    WHERE agent_id IN ('${senderId}', '${receiverId}') AND occurred_at >= ${request.created_at}
    ORDER BY occurred_at`,
);
assert(logs.length > 0, "⑤ 两侧工具有审计记录", `条数=${logs.length}`);
const byAgent = new Map();
for (const log of logs) {
  byAgent.set(log.agent_id, (byAgent.get(log.agent_id) ?? 0) + 1);
}
ok("⑤ 工具调用分布", [...byAgent].map(([id, count]) => `${id}:${count}`).join(" "));

console.log("");
console.log(`结论 ${scenario}:request=${request.id} 回执=${reply.id} 接收方任务=${receiverTask.id} 根任务=${senderTask.id}`);
console.log(`接收方结论:${(receiverTask.output ?? "").slice(0, 300)}`);
console.log(process.exitCode === 1 ? "OBSERVE FAILED" : "OBSERVE DONE");
