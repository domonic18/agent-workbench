import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  A2A_INBOX,
  A2A_INTENTS,
  ENVELOPE_LIMITS,
  TASK_LIMITS,
  TASK_STAGES,
  TASK_STATUSES,
  TOOL_GATE,
} from "../../shared/constants.js";
import { callConsole, type ConsoleClientConfig, type ConsoleRequest } from "./console-client.js";
import type { NativeTool } from "./types.js";

export interface NativeToolsConfig {
  baseUrl: string;
  agentId: string;
  agentSecret: string;
}

type Args = Record<string, unknown>;

/** 长轮询最长挂起 30s,HTTP 超时必须留出余量,否则代理先掐断 */
const INBOX_TIMEOUT_MS = A2A_INBOX.maxWaitMs + 5_000;
const DEFAULT_INBOX_WAIT_S = A2A_INBOX.waitMs / 1000;
const MAX_INBOX_WAIT_S = A2A_INBOX.maxWaitMs / 1000;

function textResult(body: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

interface ErrorDetail {
  allowedTargets?: unknown;
}

interface ErrorEnvelope {
  error?: { code?: unknown; message?: unknown; detail?: ErrorDetail | null };
}

function failureResult(status: number, body: unknown): CallToolResult {
  const envelope: ErrorEnvelope =
    typeof body === "object" && body !== null ? (body as ErrorEnvelope) : {};
  const code = typeof envelope.error?.code === "string" ? envelope.error.code : "HTTP_ERROR";
  const message =
    typeof envelope.error?.message === "string"
      ? envelope.error.message
      : `控制台返回 HTTP ${status}`;
  const targets = envelope.error?.detail?.allowedTargets;
  const suffix = Array.isArray(targets)
    ? `;可达目标: [${targets.map((item) => String(item)).join(", ")}]`
    : "";
  return errorResult(`${code}: ${message}${suffix}`);
}

/** 只挑白名单字段转发:模型塞进来的 agent_id / role / assignee / from / round 一律丢弃 */
function pick(args: Args, keys: readonly string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of keys) {
    if (args[key] !== undefined) {
      body[key] = args[key];
    }
  }
  return body;
}

async function invoke(
  config: NativeToolsConfig,
  request: ConsoleRequest,
): Promise<CallToolResult> {
  try {
    const response = await callConsole(config, request);
    if (response.status >= 200 && response.status < 300) {
      return textResult(response.body);
    }
    return failureResult(response.status, response.body);
  } catch (error) {
    return errorResult(
      `控制台调用失败:${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function requiredId(args: Args, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function createNativeTools(config: NativeToolsConfig): NativeTool[] {
  const client: ConsoleClientConfig = {
    baseUrl: config.baseUrl,
    agentId: config.agentId,
    agentSecret: config.agentSecret,
  };

  const taskCreate: NativeTool = {
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
    execute: (args) =>
      invoke(client, {
        method: "POST",
        path: "/api/tasks",
        body: pick(args, ["title", "assigner", "project", "deadlineAt", "output", "parentTaskId"]),
        idempotencyKey: randomUUID(),
      }),
  };

  const taskUpdate: NativeTool = {
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
    execute: async (args) => {
      const taskId = requiredId(args, "task_id");
      if (taskId === undefined) {
        return errorResult("task_id 必填");
      }
      return invoke(client, {
        method: "PATCH",
        path: `/api/tasks/${encodeURIComponent(taskId)}`,
        body: pick(args, ["stage", "status", "output", "deadlineAt", "reason"]),
        idempotencyKey: randomUUID(),
      });
    },
  };

  const a2aSend: NativeTool = {
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
    execute: (args) =>
      invoke(client, {
        method: "POST",
        path: "/api/a2a/messages",
        body: pick(args, [
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
        idempotencyKey: randomUUID(),
      }),
  };

  const a2aInbox: NativeTool = {
    name: "a2a_inbox",
    gateName: "a2a.inbox",
    description: `拉取发给当前 Agent 的 A2A 消息,默认长轮询 ${DEFAULT_INBOX_WAIT_S} 秒;返回即已领取,须 ACK。`,
    inputSchema: {
      type: "object",
      properties: {
        cursor: { type: "string", description: "上次返回的 nextCursor" },
        wait: {
          type: "integer",
          minimum: 0,
          maximum: MAX_INBOX_WAIT_S,
          description: `等待秒数,默认 ${DEFAULT_INBOX_WAIT_S}`,
        },
      },
    },
    execute: async (args) => {
      const query: Record<string, string> = {};
      if (typeof args.cursor === "string" && args.cursor !== "") {
        query.cursor = args.cursor;
      }
      const wait = args.wait;
      if (wait !== undefined) {
        if (
          typeof wait !== "number" ||
          !Number.isFinite(wait) ||
          wait < 0 ||
          wait > MAX_INBOX_WAIT_S
        ) {
          return errorResult(`wait 须为 0~${MAX_INBOX_WAIT_S} 的秒数`);
        }
        query.wait = `${wait}s`;
      } else {
        query.wait = `${DEFAULT_INBOX_WAIT_S}s`;
      }
      return invoke(client, {
        method: "GET",
        path: "/api/a2a/inbox",
        query,
        timeoutMs: INBOX_TIMEOUT_MS,
      });
    },
  };

  const a2aAck: NativeTool = {
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
    execute: async (args) => {
      const msgId = requiredId(args, "msg_id");
      if (msgId === undefined) {
        return errorResult("msg_id 必填");
      }
      return invoke(client, {
        method: "POST",
        path: `/api/a2a/inbox/${encodeURIComponent(msgId)}/ack`,
        body: pick(args, ["task_id"]),
      });
    },
  };

  // 启动即验闸门名登记在 TOOL_GATE,防枚举漂移(清单外会被当成 L2 审批)
  const tools = [taskCreate, taskUpdate, a2aSend, a2aInbox, a2aAck];
  const known: readonly string[] = [...TOOL_GATE.l0, ...TOOL_GATE.l1];
  for (const tool of tools) {
    if (!known.includes(tool.gateName)) {
      throw new Error(`原生工具 ${tool.name} 的闸门名 ${tool.gateName} 未登记在 TOOL_GATE`);
    }
  }
  return tools;
}
