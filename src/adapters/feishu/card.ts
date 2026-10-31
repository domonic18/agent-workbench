import type * as Lark from "@larksuiteoapi/node-sdk";
import type { CapabilityStatus } from "../../shared/constants.js";
import type { CardCallbackResult, CapabilitySnapshot } from "./callback.js";
import { ensureOk } from "./response.js";

/** 审批卡片只承载展示字段,不依赖 store 记录,避免 adapter 反向依赖 store */
export interface ApprovalCardInput {
  capabilityId: string;
  subject: string;
  target: string;
  action: string;
  ttlSeconds: number;
  taskId: string;
  scope: unknown;
}

/** 卡片 v2(schema 2.0):按钮 value 带回 capabilityId + decision,回调据此裁决 */
export function buildApprovalCard(input: ApprovalCardInput): Record<string, unknown> {
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: {
      title: { tag: "plain_text", content: "授权申请待审批" },
      template: "blue",
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: [
            `**主体**:${input.subject}`,
            `**目标**:${input.target}`,
            `**动作**:${input.action}`,
            `**范围**:${JSON.stringify(input.scope ?? {})}`,
            `**有效期**:${input.ttlSeconds} 秒`,
            `**任务**:${input.taskId}`,
            `**编号**:${input.capabilityId}`,
          ].join("\n"),
        },
        { tag: "hr" },
        // schema 2.0 不再支持 action 容器,按钮直接作为元素;回调 value 走 behaviors
        {
          tag: "button",
          text: { tag: "plain_text", content: "批准" },
          type: "primary",
          behaviors: [
            {
              type: "callback",
              value: { capabilityId: input.capabilityId, decision: "approve" },
            },
          ],
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: "拒绝" },
          type: "danger",
          behaviors: [
            {
              type: "callback",
              value: { capabilityId: input.capabilityId, decision: "reject" },
            },
          ],
        },
      ],
    },
  };
}

/** 裁决后的终态卡片:去掉按钮,只展示结果,避免重复点击 */
export interface ResolvedCardInput extends ApprovalCardInput {
  status: CapabilityStatus;
  actor?: string;
  expiresAt?: number | null;
  decision?: "approve" | "reject";
  errorCode?: string;
}

interface StatusView {
  title: string;
  template: string;
  result: string;
}

function parseScope(scopeJson: string): unknown {
  try {
    return JSON.parse(scopeJson) as unknown;
  } catch {
    return {};
  }
}

function statusView(input: ResolvedCardInput): StatusView {
  if (input.errorCode === "UPSTREAM_UNAVAILABLE") {
    return { title: "授权签发失败", template: "orange", result: "签发失败,已转拒绝" };
  }
  switch (input.status) {
    case "active":
      return { title: "授权已生效", template: "green", result: "已批准" };
    case "rejected":
      return {
        title: "授权已拒绝",
        template: "red",
        result: input.decision === "reject" ? "已拒绝" : "已转拒绝",
      };
    case "revoked":
      return { title: "授权已吊销", template: "red", result: "已吊销" };
    case "expired":
      return { title: "授权已过期", template: "grey", result: "已过期" };
    case "issuing":
      return { title: "授权签发中", template: "orange", result: "签发中" };
    case "pending":
      return { title: "授权申请待审批", template: "blue", result: "待审批" };
  }
}

export function buildResolvedCard(input: ResolvedCardInput): Record<string, unknown> {
  const view = statusView(input);
  const detailLines = [
    `**主体**:${input.subject}`,
    `**目标**:${input.target}`,
    `**动作**:${input.action}`,
    `**范围**:${JSON.stringify(input.scope ?? {})}`,
    `**有效期**:${input.ttlSeconds} 秒`,
    `**任务**:${input.taskId}`,
    `**编号**:${input.capabilityId}`,
  ];
  const resultLines = [
    `**结果**:${view.result}`,
    ...(input.actor === undefined ? [] : [`**审批人**:${input.actor}`]),
    ...(input.status === "active" && input.expiresAt !== undefined && input.expiresAt !== null
      ? [`**到期**:${new Date(input.expiresAt).toISOString()}`]
      : []),
  ];
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: {
      title: { tag: "plain_text", content: view.title },
      template: view.template,
    },
    body: {
      elements: [
        { tag: "markdown", content: detailLines.join("\n") },
        { tag: "hr" },
        { tag: "markdown", content: resultLines.join("\n") },
      ],
    },
  };
}

type ToastKind = "success" | "info" | "error" | "warning";

export interface CardCallbackResponse {
  toast: { type: ToastKind; content: string };
  /** 仅当能取到授权快照时更新卡片;无快照(非白名单 / 载荷非法 / 超窗)时只弹 toast */
  card?: { type: "raw"; data: Record<string, unknown> };
}

function toastFor(result: CardCallbackResult): { type: ToastKind; content: string } {
  switch (result.outcome) {
    case "handled":
      if (result.decision === "reject") {
        return { type: "success", content: "已拒绝该申请" };
      }
      return result.capability?.status === "active"
        ? { type: "success", content: "已批准,授权已生效" }
        : { type: "success", content: "已处理" };
    case "duplicate":
      return { type: "info", content: "该申请已处理,无需重复操作" };
    case "denied":
      return { type: "error", content: "无权限操作该审批卡片" };
    case "invalid":
      return { type: "error", content: "卡片数据不合法" };
    case "expired":
      return { type: "error", content: "操作已过期,请重新发起申请" };
    case "failed":
      if (result.errorCode === "UPSTREAM_UNAVAILABLE") {
        return { type: "error", content: "签发失败,授权已转拒绝" };
      }
      if (result.errorCode === "NOT_FOUND") {
        return { type: "error", content: "授权记录不存在" };
      }
      return { type: "error", content: "处理失败,请稍后重试" };
  }
}

function toResolvedInput(
  capability: CapabilitySnapshot,
  result: CardCallbackResult,
): ResolvedCardInput {
  return {
    capabilityId: capability.id,
    subject: capability.subject,
    target: capability.target,
    action: capability.action,
    scope: parseScope(capability.scopeJson),
    ttlSeconds: capability.ttlSeconds,
    taskId: capability.taskId,
    status: capability.status,
    ...(result.actor === undefined ? {} : { actor: result.actor }),
    ...(result.decision === undefined ? {} : { decision: result.decision }),
    ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
    ...(capability.expiresAt === null ? {} : { expiresAt: capability.expiresAt }),
  };
}

/**
 * card.action.trigger 的同步响应:toast 立即反馈,card 就地替换为终态。
 * 长时间签发若超过飞书响应窗口,重试会命中 event_id 幂等并带上快照,同样能刷新界面。
 */
export function buildCardCallbackResponse(result: CardCallbackResult): CardCallbackResponse {
  const toast = toastFor(result);
  if (result.capability === undefined) {
    return { toast };
  }
  return {
    toast,
    card: { type: "raw", data: buildResolvedCard(toResolvedInput(result.capability, result)) },
  };
}

export interface CardTarget {
  chatId: string;
  card: unknown;
}

export interface CardSender {
  send(target: CardTarget): Promise<void>;
}

/** 把发件箱载荷投递为 interactive 消息;业务状态由调用方的发件箱状态机维护 */
export function createCardSender(client: Lark.Client): CardSender {
  return {
    async send(target) {
      const response = await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: target.chatId,
          msg_type: "interactive",
          content: JSON.stringify(target.card),
        },
      });
      ensureOk(response, "发送审批卡片");
    },
  };
}
