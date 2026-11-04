import { randomUUID } from "node:crypto";
import {
  A2A_INBOX,
  A2A_INTENTS,
  A2A_PROTOCOL_VERSION,
  ENVELOPE_LIMITS,
  TASK_LIMITS,
  TASK_STAGES,
  TASK_STATUSES,
  TOOL_GATE,
  type TaskStage,
  type TaskStatus,
} from "../shared/constants.js";
import { validateEnvelope } from "../shared/protocol.js";
import { announceAck, announceHandoff, announceTaskUpdate } from "../domain/collab/announce.js";
import { writeKnowledgeCandidate } from "../domain/knowledge/agent-write.js";
import { searchKnowledge } from "../domain/knowledge/retrieval.js";
import type { TaskCreateInput } from "../domain/task/service.js";
import {
  errorResult,
  nullableText,
  optionalNumber,
  optionalText,
  pick,
  textResult,
  type ConsoleTool,
  type ConsoleToolDeps,
} from "./console-shared.js";

const MAX_INBOX_WAIT_S = A2A_INBOX.maxWaitMs / 1000;
const KB_SEARCH_LIMIT_MAX = 20;

function createTaskTools(deps: ConsoleToolDeps): ConsoleTool[] {
  return [
    {
      name: "task_create",
      gateName: "task.create",
      description:
        "新建任务。assignee 由服务端按当前 Agent 身份注入,不接受自述;可选 parentTaskId 续接自己的任务。",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: TASK_LIMITS.title },
          assigner: { type: "string" },
          project: { type: "string" },
          deadlineAt: { type: "integer", description: "毫秒时间戳" },
          output: { type: "string", description: "kb_* 条目 id 或 http(s) 链接" },
          parentTaskId: { type: "string" },
        },
        required: ["title", "assigner", "project"],
      },
      auditTaskId: () => null,
      execute: async (agent, args) => {
        const task = await deps.tasks.create({
          ...pick(args, ["title", "assigner", "project", "deadlineAt", "output", "parentTaskId"]),
          assignee: agent.id,
        } as TaskCreateInput);
        return textResult({ task });
      },
    },
    {
      name: "task_update",
      gateName: "task.update",
      description: "推进自己名下任务的状态 / 阶段,或更新输出引用与截止时间。",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          stage: { type: "string", enum: [...TASK_STAGES] },
          status: { type: "string", enum: [...TASK_STATUSES] },
          output: { type: "string", description: "kb_* 条目 id 或 http(s) 链接" },
          deadlineAt: { type: "integer", description: "毫秒时间戳" },
          reason: { type: "string", description: "返工原因,review→running 时记录" },
        },
        required: ["task_id"],
      },
      auditTaskId: (args) => optionalText(args.task_id) ?? null,
      execute: async (agent, args) => {
        const taskId = optionalText(args.task_id);
        if (taskId === undefined) {
          return errorResult("task_id 必填");
        }
        const { task, autoClosed } = await deps.tasks.update({
          taskId,
          assignee: agent.id,
          stage: optionalText(args.stage) as TaskStage | undefined,
          status: optionalText(args.status) as TaskStatus | undefined,
          output: nullableText(args.output),
          deadlineAt: optionalNumber(args.deadlineAt),
          reason: optionalText(args.reason),
        });
        // ③ 完成播报 + ④ 验收播报,与 HTTP 路由同一收敛点
        await announceTaskUpdate(deps.announce, deps.tasks, task, autoClosed);
        return textResult({ task });
      },
    },
  ];
}

function createA2aTools(deps: ConsoleToolDeps): ConsoleTool[] {
  const a2aSend: ConsoleTool = {
    name: "a2a_send",
    gateName: "a2a.send",
    description: "向委派白名单内的 Agent 发送 A2A 消息;from 与 round 由服务端注入。",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "自己名下的任务" },
        to: { type: "string" },
        intent: { type: "string", enum: [...A2A_INTENTS] },
        summary: { type: "string", maxLength: ENVELOPE_LIMITS.summary },
        expect: { type: "string", maxLength: ENVELOPE_LIMITS.expect },
        deadline: { type: "string", description: "RFC3339 时间;request/reply/escalate 必填" },
        refs: { type: "array", items: { type: "string" }, maxItems: ENVELOPE_LIMITS.refs },
        auth: { type: "object", properties: { ticket_id: { type: "string" } } },
        thread_id: { type: "string" },
        reply_to: { type: "string" },
      },
      required: ["task_id", "to", "intent", "summary", "expect"],
    },
    auditTaskId: (args) => optionalText(args.task_id) ?? null,
    execute: async (agent, args) => {
      // from / v / round 一律服务端注入,客户端给值被覆盖
      const validation = validateEnvelope({
        ...pick(args, [
          "task_id",
          "to",
          "intent",
          "summary",
          "expect",
          "deadline",
          "refs",
          "auth",
          "thread_id",
          "reply_to",
        ]),
        v: A2A_PROTOCOL_VERSION,
        from: agent.id,
        round: 1,
      });
      if (!validation.ok) {
        return errorResult(
          `VALIDATION_FAILED: A2A 信封字段缺失或非法;${validation.issues
            .map((issue) => `${issue.field} ${issue.message}`)
            .join(";")}`,
        );
      }
      const envelope = validation.envelope;
      const threadId = optionalText(args.thread_id);
      const replyTo = optionalText(args.reply_to);
      const result = await deps.a2a.send({
        idempotencyKey: randomUUID(),
        fromAgentId: agent.id,
        taskId: envelope.task_id,
        to: envelope.to,
        intent: envelope.intent,
        summary: envelope.summary,
        expect: envelope.expect,
        deadlineAt: envelope.deadline === undefined ? null : Date.parse(envelope.deadline),
        refs: envelope.refs ?? [],
        authTicketId: envelope.auth?.ticket_id ?? null,
        ...(threadId === undefined ? {} : { threadId }),
        ...(replyTo === undefined ? {} : { replyToMsgId: replyTo }),
      });
      // ① 交接播报,与 HTTP 路由同一收敛点
      await announceHandoff(deps.announce, deps.a2a, result.msgId);
      return textResult({ msg_id: result.msgId, thread_id: result.threadId, round: result.round });
    },
  };

  const a2aInbox: ConsoleTool = {
    name: "a2a_inbox",
    gateName: "a2a.inbox",
    description: `拉取发给当前 Agent 的 A2A 消息,默认长轮询 ${A2A_INBOX.waitMs / 1000} 秒;返回即已领取,须 ACK。`,
    inputSchema: {
      type: "object",
      properties: {
        cursor: { type: "string", description: "上次返回的 nextCursor" },
        wait: {
          type: "integer",
          minimum: 0,
          maximum: MAX_INBOX_WAIT_S,
          description: `等待秒数,默认 ${A2A_INBOX.waitMs / 1000}`,
        },
      },
    },
    auditTaskId: () => null,
    execute: async (agent, args) => {
      const cursor = optionalText(args.cursor);
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
      const result = await deps.a2a.inbox(agent.id, {
        ...(cursor === undefined ? {} : { cursor }),
        ...(waitMs === undefined ? {} : { waitMs }),
      });
      return textResult(result);
    },
  };

  const a2aAck: ConsoleTool = {
    name: "a2a_ack",
    gateName: "a2a.ack",
    description: "ACK 发给自己的消息;request / escalate 须带上自己承接的 task_id。",
    inputSchema: {
      type: "object",
      properties: {
        msg_id: { type: "string" },
        task_id: { type: "string", description: "下游承接任务,request / escalate 必填" },
      },
      required: ["msg_id"],
    },
    auditTaskId: (args) => optionalText(args.task_id) ?? null,
    execute: async (agent, args) => {
      const msgId = optionalText(args.msg_id);
      if (msgId === undefined) {
        return errorResult("msg_id 必填");
      }
      const taskId = optionalText(args.task_id);
      const autoClosed = await deps.a2a.ack(
        agent.id,
        msgId,
        taskId === undefined ? {} : { taskId },
      );
      // ② 接单播报 + ④ 验收播报,与 HTTP 路由同一收敛点
      await announceAck(deps.announce, deps.a2a, msgId, taskId, autoClosed);
      return textResult({ ok: true });
    },
  };

  return [a2aSend, a2aInbox, a2aAck];
}

function createKbTools(deps: ConsoleToolDeps): ConsoleTool[] {
  return [
    {
      name: "kb_search",
      gateName: "kb.search",
      description: "知识检索:返回带出处的知识片段(条目 id / 路径 / 命中分块),只读不改。",
      inputSchema: {
        type: "object",
        properties: {
          search: { type: "string", description: "关键词,空串无意义" },
          limit: { type: "integer", minimum: 1, maximum: KB_SEARCH_LIMIT_MAX },
        },
        required: ["search"],
      },
      auditTaskId: () => null,
      execute: async (_agent, args) => {
        const search = optionalText(args.search);
        if (search === undefined) {
          return errorResult("search 必填");
        }
        const limit = args.limit;
        if (
          limit !== undefined &&
          (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > KB_SEARCH_LIMIT_MAX)
        ) {
          return errorResult(`limit 须为 1~${KB_SEARCH_LIMIT_MAX} 的整数`);
        }
        const hits = await searchKnowledge(deps.db, { search, ...(limit === undefined ? {} : { limit }) });
        return textResult({ hits });
      },
    },
    {
      name: "kb_write",
      gateName: "kb.write",
      description:
        "写入知识候选(状态恒 candidate,采纳只能由人在控制台完成);来源任务必须属于当前 Agent,路径不得触碰受保护文件。",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "自己名下的任务" },
          path: { type: "string", description: "知识目录内相对路径,如 notes/bug-fix.md" },
          title: { type: "string" },
          summary: { type: "string" },
          category: { type: "string" },
          content: { type: "string", description: "Markdown 正文" },
        },
        required: ["task_id", "path", "title", "content"],
      },
      auditTaskId: (args) => optionalText(args.task_id) ?? null,
      execute: async (agent, args) => {
        const taskId = optionalText(args.task_id);
        const path = optionalText(args.path);
        const title = optionalText(args.title);
        const content = typeof args.content === "string" ? args.content : undefined;
        if (taskId === undefined || path === undefined || title === undefined || content === undefined) {
          return errorResult("task_id、path、title 与 content 必填");
        }
        const written = await writeKnowledgeCandidate(
          agent,
          {
            taskId,
            path,
            title,
            summary: optionalText(args.summary),
            category: optionalText(args.category),
            content,
          },
          { db: deps.db, knowledgeDir: deps.knowledgeDir },
        );
        return textResult(written);
      },
    },
  ];
}

/** 首版封闭集合(arch01 §5.2):7 个自有控制工具;启动即验闸门名登记,防枚举漂移 */
export function createConsoleTools(deps: ConsoleToolDeps): ConsoleTool[] {
  const tools = [...createTaskTools(deps), ...createA2aTools(deps), ...createKbTools(deps)];
  const known: readonly string[] = [...TOOL_GATE.l0, ...TOOL_GATE.l1];
  for (const tool of tools) {
    if (!known.includes(tool.gateName)) {
      throw new Error(`控制工具 ${tool.name} 的闸门名 ${tool.gateName} 未登记在 TOOL_GATE`);
    }
  }
  return tools;
}
