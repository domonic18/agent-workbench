import { enqueuePush } from "../../reliability/outbox.js";
import type { Db } from "../../store/database.js";
import { findWorkItemById } from "../../store/repositories/work-item.js";
import { findWorkTriggerById } from "../../store/repositories/work-trigger.js";

/**
 * 工作事项状态通知线(M3.9-2 通知补刀,arch/01 §9.4 状态可见性):
 * 事项到达关键节点时按 origin 触发的 thread_key 回溯原反馈群,经发件箱
 * 推一条文本——用户看得见进度,acceptance_ready 直接写明裁决口令。
 * 只覆盖 bug 来源(唯一带 thread_key 的来源);解析不出 chat 即静默跳过,
 * 不抛错不阻塞业务事务。与事件 append 同事务入队,幂等键挂 eventId。
 */

/** 进群的通知事件;其余事件(routed/assigned/accepted/input/ci_result/pr_closed)只留库 */
export type WorkNotifyKind =
  | "task_bound"
  | "pr_linked"
  | "ci_failed"
  | "acceptance_ready"
  | "returned";

export interface NotifyWorkEventInput {
  workItemId: string;
  eventId: string;
  kind: WorkNotifyKind;
  /** returned 的退回理由 */
  reason?: string | undefined;
  /** PR 链接;evidence 分支从事件 payload 直传,缺失则文案省略 */
  prUrl?: string | undefined;
  now?: number | undefined;
}

interface OriginInfo {
  chatId: string;
  issueNo: string | null;
}

/** thread_key 形如 `chat_id:message_id`;no-thread:* 或无冒号视为无定位 */
function parseChatId(threadKey: string): string | null {
  if (threadKey.startsWith("no-thread:")) {
    return null;
  }
  const idx = threadKey.indexOf(":");
  if (idx <= 0) {
    return null;
  }
  return threadKey.slice(0, idx);
}

async function resolveOrigin(db: Db, originTriggerId: string | null): Promise<OriginInfo | null> {
  if (originTriggerId === null) {
    return null;
  }
  const trigger = await findWorkTriggerById(db, originTriggerId);
  if (trigger === undefined) {
    return null;
  }
  const payload = JSON.parse(trigger.payloadJson) as { thread_key?: unknown };
  const chatId = typeof payload.thread_key === "string" ? parseChatId(payload.thread_key) : null;
  if (chatId === null) {
    return null;
  }
  const refs = JSON.parse(trigger.threadRefsJson) as ReadonlyArray<{
    externalKind?: unknown;
    externalKey?: unknown;
  }>;
  let issueNo: string | null = null;
  for (const ref of refs) {
    if (ref.externalKind !== "issue" || typeof ref.externalKey !== "string") {
      continue;
    }
    const tail = ref.externalKey.split("/").pop() ?? "";
    if (tail !== "") {
      issueNo = tail;
      break;
    }
  }
  return { chatId, issueNo };
}

/** 纯文本消息无富文本渲染,只需压掉换行防拆行 */
function flat(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

function returnHint(issueNo: string | null): string {
  return issueNo === null
    ? "回复『退回：理由』返工"
    : `回复『#${issueNo} 退回：理由』返工`;
}

function verdictHint(issueNo: string | null): string {
  return issueNo === null
    ? `回复『接受』收口，或${returnHint(issueNo)}`
    : `回复『#${issueNo} 接受』收口，或${returnHint(issueNo)}`;
}

function buildText(
  kind: WorkNotifyKind,
  title: string,
  issueNo: string | null,
  reason: string | undefined,
  prUrl: string | undefined,
): string {
  const bug = issueNo === null ? "" : `Bug #${issueNo} `;
  switch (kind) {
    case "task_bound":
      return `📦 ${bug}「${flat(title)}」已被 worker 接单，开始修复`;
    case "pr_linked":
      return prUrl === undefined
        ? `🔧 ${bug}修复已提交 PR，CI 运行中`
        : `🔧 ${bug}修复已提交 PR（CI 运行中）：${prUrl}`;
    case "ci_failed":
      return `❌ ${bug}PR CI 未通过，事项停留修复阶段；修复重推后自动重判，也可${returnHint(issueNo)}`;
    case "acceptance_ready":
      return `✅ ${bug}「${flat(title)}」CI 全绿，待验收${
        prUrl === undefined ? "" : `（PR：${prUrl}）`
      }。${verdictHint(issueNo)}`;
    case "returned":
      return `↩️ ${bug}已退回返工：${flat(reason ?? "未注明原因")}；worker 将重新修复`;
  }
}

/**
 * 通知入队入口:各事件 append 站点在业务事务内调用。
 * chat 解析失败(无 origin/无 thread_key/格式异常)静默 return——通知是
 * 副通道,不产生「因群不可达而事项写不进」的反向耦合。
 */
export async function notifyWorkEvent(db: Db, input: NotifyWorkEventInput): Promise<void> {
  const item = await findWorkItemById(db, input.workItemId);
  if (item === undefined) {
    return;
  }
  const origin = await resolveOrigin(db, item.originTriggerId);
  if (origin === null) {
    return;
  }
  const text = buildText(input.kind, item.title, origin.issueNo, input.reason, input.prUrl);
  await enqueuePush(db, {
    idempotencyKey: `work-notify:${input.eventId}`,
    kind: "work_notify",
    chatId: origin.chatId,
    text,
    uuid: input.eventId,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}
