import type { Db } from "../../store/database.js";
import {
  appendWorkItemEvent,
  findWorkItemById,
  updateWorkItemProjection,
  type WorkItemRecord,
} from "../../store/repositories/work-item.js";
import {
  findWorkThreadByKey,
  insertSubscriptionIfNew,
  insertWorkThreadIfNew,
  touchWorkThreadTrigger,
} from "../../store/repositories/work-thread.js";
import type { DispatchContext } from "./contract.js";
import type { DispatchDeps, DispatchOutcome, OwnerContinueOutcome } from "./dispatch.js";
import { notifyWorkEvent } from "./notify.js";

/**
 * github 证据分支(M3.9-2,arch/01 §9.2 ③窄化 + §9.4 ④):pr/check 事件命中
 * owner 事项时只落证据事件与末态投影,不投 worker_inbox——CI 波动不该反复
 * 唤醒 worker。PR 线程 {github|pull_request|<api url>} 首次出现即建 owner
 * 订阅,让不带 PR 正文的 check_suite 也能沿该线程回流到同一事项。
 * 待验收判定口径(§9.4 ④):只有 PR 当前 head SHA 的 check_suite 全绿才进
 * acceptance;旧 SHA 绿、当前 SHA 红、自报完成都不算。
 */

interface ValidationState {
  prUrl: string | null;
  headSha: string | null;
  suiteConclusion: string | null;
  updatedAt: number;
}

function readValidation(item: WorkItemRecord): ValidationState {
  if (item.validationJson !== null) {
    const parsed = JSON.parse(item.validationJson) as Partial<ValidationState>;
    return {
      prUrl: typeof parsed.prUrl === "string" ? parsed.prUrl : null,
      headSha: typeof parsed.headSha === "string" ? parsed.headSha : null,
      suiteConclusion: typeof parsed.suiteConclusion === "string" ? parsed.suiteConclusion : null,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  }
  return { prUrl: null, headSha: null, suiteConclusion: null, updatedAt: 0 };
}

function textOf(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export async function dispatchGithubEvidence(
  db: Db,
  ctx: DispatchContext,
  deps: Pick<DispatchDeps, "policy" | "newEventId" | "newThreadId" | "newSubscriptionId">,
  outcome: OwnerContinueOutcome,
): Promise<DispatchOutcome> {
  const kind = ctx.request.kind;
  const payload = ctx.request.payload;
  const item = await findWorkItemById(db, outcome.workItemId);

  const prApiUrl = textOf(payload, "pr_api_url");
  if (prApiUrl !== undefined && kind !== "check.completed" && item !== undefined) {
    await insertWorkThreadIfNew(db, {
      id: deps.newThreadId(),
      source: "github",
      externalKind: "pull_request",
      externalKey: prApiUrl,
      project: item.project,
      createdAt: ctx.at,
    });
    const thread = await findWorkThreadByKey(db, "github", "pull_request", prApiUrl);
    if (thread !== undefined) {
      await touchWorkThreadTrigger(db, thread.id, ctx.at);
      // 已有 owner(PR 后续 synchronize 重放)时幂等跳过;证据不换绑 owner
      await insertSubscriptionIfNew(db, {
        id: deps.newSubscriptionId(),
        workThreadId: thread.id,
        workItemId: outcome.workItemId,
        mode: "owner",
        createdBy: "router",
        policyVersion: deps.policy.version,
        createdAt: ctx.at,
      });
    }
  }

  const eventKind =
    kind === "check.completed" ? "ci_result" : kind === "pr.closed" ? "pr_closed" : "pr_linked";
  let decidedKind: string | null = null;

  if (item !== undefined) {
    if (kind === "pr.opened" || kind === "pr.synchronized") {
      const headSha = textOf(payload, "head_sha");
      const prUrl = textOf(payload, "pr_url");
      if (headSha !== undefined && prUrl !== undefined) {
        // 新 head SHA 使旧 CI 结论失效;已进入待验收的事项退回执行态等新证据
        await updateWorkItemProjection(db, {
          id: item.id,
          validationJson: JSON.stringify({
            prUrl,
            headSha,
            suiteConclusion: null,
            updatedAt: ctx.at,
          } satisfies ValidationState),
          ...(item.attention === "acceptance"
            ? { attention: "none" as const, nextAction: "PR 有新提交,等待新 head SHA 的 CI 结论" }
            : { nextAction: item.nextAction }),
          updatedAt: ctx.at,
        });
      }
    } else if (kind === "pr.closed") {
      const merged = payload["merged"] === true;
      await updateWorkItemProjection(db, {
        id: item.id,
        attention: "stalled",
        nextAction: `PR 已关闭(${merged ? "已合并" : "未合并"}):等待人工决定重开或收口`,
        updatedAt: ctx.at,
      });
    } else if (kind === "check.completed") {
      const headSha = textOf(payload, "head_sha");
      const conclusion = textOf(payload, "conclusion");
      const validation = readValidation(item);
      if (
        validation.headSha === null ||
        validation.prUrl === null ||
        headSha === undefined ||
        headSha !== validation.headSha
      ) {
        // 无 PR 关联或旧 SHA 的结论:只留痕,不参与判定(§9.4 ④)
      } else if (conclusion === "success") {
        validation.suiteConclusion = "success";
        validation.updatedAt = ctx.at;
        await updateWorkItemProjection(db, {
          id: item.id,
          stage: "review",
          attention: "acceptance",
          validationJson: JSON.stringify(validation),
          nextAction: "等待原 Bug 机器人人工接受",
          updatedAt: ctx.at,
        });
        decidedKind = "acceptance_ready";
      } else {
        validation.suiteConclusion = conclusion ?? "unknown";
        validation.updatedAt = ctx.at;
        // 当前 SHA 红不进待验收:attention 不变,修复重推后新 suite 自会重判
        await updateWorkItemProjection(db, {
          id: item.id,
          validationJson: JSON.stringify(validation),
          nextAction: item.nextAction,
          updatedAt: ctx.at,
        });
        decidedKind = "ci_failed";
      }
    }
  }

  const eventId = deps.newEventId();
  const appendedKind = decidedKind ?? eventKind;
  await appendWorkItemEvent(db, {
    id: eventId,
    workItemId: outcome.workItemId,
    kind: appendedKind,
    triggerId: ctx.triggerId,
    evidenceRefsJson: ctx.refsJson,
    payloadJson: JSON.stringify(payload),
    occurredAt: ctx.at,
  });
  if (
    appendedKind === "pr_linked" ||
    appendedKind === "acceptance_ready" ||
    appendedKind === "ci_failed"
  ) {
    // check.completed payload 不带 pr_url,待验收文案的 PR 链接从 validation 状态回读
    const prUrl =
      textOf(payload, "pr_url") ??
      (item !== undefined ? (readValidation(item).prUrl ?? undefined) : undefined);
    await notifyWorkEvent(db, {
      workItemId: outcome.workItemId,
      eventId,
      kind: appendedKind,
      prUrl,
      now: ctx.at,
    });
  }
  return {
    resolved: {
      disposition: "continued",
      reasonCode: null,
      ruleId: null,
      ruleVersion: null,
      workItemId: outcome.workItemId,
      targetAgentId: null,
    },
    newInboxIds: [],
  };
}
