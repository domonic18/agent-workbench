import { WORK_INBOX } from "../shared/constants.js";
import {
  errorResult,
  optionalText,
  textResult,
  type ConsoleTool,
  type ConsoleToolDeps,
} from "./console-shared.js";

const MAX_INBOX_WAIT_S = WORK_INBOX.maxWaitMs / 1000;

/**
 * work 域 4 工具(arch/01 §9.1-9.3):承接链 work_inbox → work_read →
 * task_create(work_item_id) → work_ack;超范围单事件 work_handback。
 * 身份一律取 Bearer;归属校验在 domain/worker-service,不在本层。
 */
export function createWorkTools(deps: ConsoleToolDeps): ConsoleTool[] {
  return [
    {
      name: "work_inbox",
      gateName: "work.inbox",
      description:
        `领取发给当前 Agent 的派工(assignment)与续接输入(input),领取即持 ${WORK_INBOX.leaseMs / 60_000} 分钟租约;` +
        "assignment 须以 work_read 读事项后用 task_create(work_item_id) 建承接任务,再 work_ack 确认;input 是上下文,读懂即 ACK。",
      inputSchema: {
        type: "object",
        properties: {
          wait: {
            type: "integer",
            minimum: 0,
            maximum: MAX_INBOX_WAIT_S,
            description: `长轮询秒数,默认 0(立即返回),最长 ${MAX_INBOX_WAIT_S}`,
          },
        },
      },
      auditTaskId: () => null,
      execute: async (agent, args) => {
        const wait = args.wait;
        let waitMs: number | undefined;
        if (wait !== undefined) {
          if (
            typeof wait !== "number" ||
            !Number.isFinite(wait) ||
            wait < 0 ||
            wait > MAX_INBOX_WAIT_S
          ) {
            return errorResult(`wait 须为 0~${MAX_INBOX_WAIT_S} 的秒数`);
          }
          waitMs = wait * 1000;
        }
        const claimed = await deps.workers.inbox(agent.id, {
          ...(waitMs === undefined ? {} : { waitMs }),
        });
        return textResult({
          inbox: claimed.map(({ inbox, workItem }) => ({
            inbox_id: inbox.id,
            kind: inbox.kind,
            trigger_id: inbox.triggerId,
            lease_until: inbox.leaseUntil,
            work_item_id: inbox.workItemId,
            work_item_title: workItem.title,
            expected_result: workItem.expectedResult,
            payload: JSON.parse(inbox.payloadJson) as unknown,
          })),
        });
      },
    },
    {
      name: "work_read",
      gateName: "work.read",
      description:
        "读取自己承接的工作事项:Mandate(expected_result/scope)与事件历史;知道事项 ID 不等于有权读,须由 inbox 指向自己。",
      inputSchema: {
        type: "object",
        properties: {
          work_item_id: { type: "string" },
        },
        required: ["work_item_id"],
      },
      auditTaskId: () => null,
      execute: async (agent, args) => {
        const workItemId = optionalText(args.work_item_id);
        if (workItemId === undefined) {
          return errorResult("work_item_id 必填");
        }
        const { item, events } = await deps.workers.read(agent.id, workItemId);
        return textResult({
          work_item: { ...item, scope: JSON.parse(item.scopeJson) as unknown },
          events: events.map((event) => ({
            seq: event.seq,
            kind: event.kind,
            trigger_id: event.triggerId,
            payload: JSON.parse(event.payloadJson) as unknown,
            occurred_at: event.occurredAt,
          })),
        });
      },
    },
    {
      name: "work_ack",
      gateName: "work.ack",
      description:
        "确认已领取的派工行:assignment 必带 task_id(自己名下、由该事项派生);input 不带 task_id,读懂即消费。",
      inputSchema: {
        type: "object",
        properties: {
          inbox_id: { type: "string" },
          task_id: { type: "string", description: "承接任务 id,assignment 必填" },
        },
        required: ["inbox_id"],
      },
      auditTaskId: (args) => optionalText(args.task_id) ?? null,
      execute: async (agent, args) => {
        const inboxId = optionalText(args.inbox_id);
        if (inboxId === undefined) {
          return errorResult("inbox_id 必填");
        }
        const taskId = optionalText(args.task_id);
        await deps.workers.ack(agent.id, inboxId, taskId ?? null);
        return textResult({ ok: true });
      },
    },
    {
      name: "work_handback",
      gateName: "work.handback",
      description:
        "按单条 Trigger 退回(超出 Mandate 范围或归属错误时);只释放该事件归属,不退订整个 Thread。",
      inputSchema: {
        type: "object",
        properties: {
          inbox_id: { type: "string" },
          reason: { type: "string", description: "退回理由,必填" },
        },
        required: ["inbox_id", "reason"],
      },
      auditTaskId: () => null,
      execute: async (agent, args) => {
        const inboxId = optionalText(args.inbox_id);
        const reason = optionalText(args.reason);
        if (inboxId === undefined || reason === undefined) {
          return errorResult("inbox_id 与 reason 必填");
        }
        await deps.workers.handback(agent.id, inboxId, reason);
        return textResult({ ok: true });
      },
    },
  ];
}
