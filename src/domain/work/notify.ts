import { enqueuePush } from "../../reliability/outbox.js";
import type { Db } from "../../store/database.js";
import { findAgentById } from "../../store/repositories/identity.js";
import { findWorkItemById } from "../../store/repositories/work-item.js";
import { findActiveAssignee } from "../../store/repositories/work-inbox.js";
import { findWorkTriggerById } from "../../store/repositories/work-trigger.js";
import { mdText, statusCard } from "../collab/card.js";

/**
 * 工作事项状态通知线(M3.9-2 通知补刀,arch/01 §9.4 状态可见性):
 * 事项到达关键节点时,控制台以自身应用把状态卡片发到协作群(与协作播报同一体系),
 * 用户在反馈渠道(私聊/群)提交与裁决,控制台在群里留下唯一的状态投影。
 * 卡片形态与协作播报共用 domain/collab/card.ts;群未配置时不入队。
 */

/** 进群通知的状态事件;其余事件(routed/assigned/input/ci_result/pr_closed)只留库 */
export type WorkNotifyKind =
  | "task_bound"
  | "pr_linked"
  | "ci_failed"
  | "acceptance_ready"
  | "returned"
  | "accepted";

export interface NotifyWorkEventInput {
  workItemId: string;
  eventId: string;
  kind: WorkNotifyKind;
  /** 目标群(控制台协作群);未配置时不入队,与协作播报同口径 */
  chatId: string | undefined;
  /** returned 的退回理由 */
  reason?: string | undefined;
  /** PR 链接;evidence 分支从事件 payload 直传,缺失则文案省略 */
  prUrl?: string | undefined;
  now?: number | undefined;
}

/** 事项的 issue 编号:origin 触发的 threadRefs 里 issue 引用 URL 的尾段 */
async function resolveIssueNo(db: Db, originTriggerId: string | null): Promise<string | null> {
  if (originTriggerId === null) {
    return null;
  }
  const trigger = await findWorkTriggerById(db, originTriggerId);
  if (trigger === undefined) {
    return null;
  }
  const refs = JSON.parse(trigger.threadRefsJson) as ReadonlyArray<{
    externalKind?: unknown;
    externalKey?: unknown;
  }>;
  for (const ref of refs) {
    if (ref.externalKind !== "issue" || typeof ref.externalKey !== "string") {
      continue;
    }
    const tail = ref.externalKey.split("/").pop() ?? "";
    if (tail !== "") {
      return tail;
    }
  }
  return null;
}

/** 接单机器人名:事项当前承接者 agent 的登记名;未接单时留空 */
async function resolveAssigneeName(db: Db, workItemId: string): Promise<string> {
  const agentId = await findActiveAssignee(db, workItemId);
  if (agentId === undefined) {
    return "";
  }
  const agent = await findAgentById(db, agentId);
  return agent?.displayName ?? "";
}

interface CardSpec {
  title: string;
  template: string;
  body: string;
}

/** 裁决口令:issue 编号齐全时带号,否则裸口令 */
function verdictLine(issueNo: string | null): string {
  const accept = issueNo === null ? "『接受』" : `『#${issueNo} 接受』`;
  const returned = issueNo === null ? "『退回：理由』" : `『#${issueNo} 退回：理由』`;
  return `在反馈渠道回复 ${accept} 收口,或 ${returned} 返工`;
}

function buildCard(
  kind: WorkNotifyKind,
  title: string,
  issueNo: string | null,
  assignee: string,
  reason: string | undefined,
  prUrl: string | undefined,
): CardSpec {
  // 卡片头是纯文本(不解析 markdown),正文是 markdown:同一名字两种转义
  const whoRaw = assignee === "" ? "接单机器人" : assignee;
  const who = mdText(whoRaw);
  const item = `**事项**:${mdText(title)}`;
  const bug = issueNo === null ? "" : `**缺陷**:Bug #${issueNo}\n`;
  const pr = prUrl === undefined ? "" : `**PR**:${mdText(prUrl)}\n`;
  switch (kind) {
    case "task_bound":
      return {
        title: `〔接单〕${whoRaw} 已接单`,
        template: "turquoise",
        body: `${item}\n${bug}**状态**:开始修复`,
      };
    case "pr_linked":
      return {
        title: `〔提 PR〕${whoRaw} 已提交修复`,
        template: "blue",
        body: `${item}\n${bug}${pr}**状态**:CI 运行中`,
      };
    case "ci_failed":
      return {
        title: `〔CI 未通过〕${mdText(title)}`,
        template: "red",
        body: `${item}\n${bug}${pr}**状态**:CI 未通过,事项停留在修复阶段;修复重推后自动重判`,
      };
    case "acceptance_ready":
      return {
        title: `〔待验收〕${mdText(title)}`,
        template: "green",
        body: `${item}\n${bug}${pr}**验收**:${verdictLine(issueNo)}`,
      };
    case "returned":
      return {
        title: `〔退回返工〕${mdText(title)}`,
        template: "orange",
        body: `${item}\n${bug}**理由**:${mdText(reason ?? "未注明原因")}\n**状态**:已退回,${who} 将重新修复`,
      };
    case "accepted":
      return {
        title: `〔已验收〕${mdText(title)}`,
        template: "indigo",
        body: `${item}\n${bug}${pr}**状态**:人工接受,事项已收口`,
      };
  }
}

/**
 * 通知入队入口:各事件 append 站点在业务事务内调用。
 * 群未配置时静默不入队——通知是副通道,不产生「因群不可达而事项写不进」的反向耦合。
 */
export async function notifyWorkEvent(db: Db, input: NotifyWorkEventInput): Promise<void> {
  if (input.chatId === undefined) {
    return;
  }
  const item = await findWorkItemById(db, input.workItemId);
  if (item === undefined) {
    return;
  }
  const issueNo = await resolveIssueNo(db, item.originTriggerId);
  const assignee = await resolveAssigneeName(db, input.workItemId);
  const spec = buildCard(
    input.kind,
    item.title,
    issueNo,
    assignee,
    input.reason,
    input.prUrl,
  );
  await enqueuePush(db, {
    idempotencyKey: `work-notify:${input.eventId}`,
    kind: "work_notify",
    chatId: input.chatId,
    card: statusCard(spec),
    uuid: input.eventId,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}
