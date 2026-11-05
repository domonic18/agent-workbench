import type { Db } from "../../store/database.js";
import { newPrefixedId } from "../../shared/ids.js";
import { findWorkItemById } from "../../store/repositories/work-item.js";
import {
  findWorkTriggerBySourceEvent,
  insertWorkTriggerIfNew,
  saveTriggerDisposition,
} from "../../store/repositories/work-trigger.js";
import {
  findActiveOwnerSubscription,
  findWorkThreadByKey,
  insertWorkThreadIfNew,
  touchWorkThreadTrigger,
} from "../../store/repositories/work-thread.js";
import { buildWorkPolicy, type WorkPolicy } from "../routing/policy.js";
import { routeTrigger, threadKeyOf, type OwnerView } from "../routing/router.js";
import type { DispatchContext, IngestResult, WorkRequest } from "./contract.js";
import { WorkIngestError } from "./contract.js";
import { dispatchAssign, dispatchOwnerContinue, type DispatchDeps, type DispatchOutcome } from "./dispatch.js";

export interface IngestDeps {
  db: Db;
  now: () => number;
  policy?: WorkPolicy;
  newTriggerId?: () => string;
  newItemId?: () => string;
  newEventId?: () => string;
  newInboxId?: () => string;
  newThreadId?: () => string;
  newSubscriptionId?: () => string;
}

/**
 * ingest 事务编排(arch/02 §3.9 L268):触发去重、Thread 建联、路由、
 * Mandate 快照、worker_inbox 与事项事件全部在同一事务内,提交后
 * 「为什么派给它」只有一个可重放答案。副作用分支见 dispatch.ts。
 */
export function createIngestService(deps: IngestDeps) {
  const db = deps.db;
  const now = deps.now;
  const policy = deps.policy ?? buildWorkPolicy();
  const newTriggerId = deps.newTriggerId ?? (() => newPrefixedId("wtg"));
  const dispatchDeps: DispatchDeps = {
    policy,
    newItemId: deps.newItemId ?? (() => newPrefixedId("wim")),
    newEventId: deps.newEventId ?? (() => newPrefixedId("wev")),
    newInboxId: deps.newInboxId ?? (() => newPrefixedId("wib")),
    newSubscriptionId: deps.newSubscriptionId ?? (() => newPrefixedId("wsb")),
  };
  const newThreadId = deps.newThreadId ?? (() => newPrefixedId("wth"));

  function validate(req: WorkRequest): void {
    if (req.source.trim() === "") throw new WorkIngestError("VALIDATION_FAILED", "source 不能为空");
    if (req.sourceEventId.trim() === "") {
      throw new WorkIngestError("VALIDATION_FAILED", "sourceEventId 不能为空");
    }
    if (req.kind.trim() === "") throw new WorkIngestError("VALIDATION_FAILED", "kind 不能为空");
    if (!Number.isInteger(req.occurredAt) || req.occurredAt < 0) {
      throw new WorkIngestError("VALIDATION_FAILED", "occurredAt 必须是非负整数毫秒时间戳");
    }
    if (req.project !== undefined && req.project.trim() === "") {
      throw new WorkIngestError("VALIDATION_FAILED", "project 不能为空串");
    }
    if (!Array.isArray(req.threadRefs)) {
      throw new WorkIngestError("VALIDATION_FAILED", "threadRefs 必须是数组");
    }
  }

  /**
   * Thread 建联(仅登记有项目的触发;无项目的触发照常路由,只是无处挂 Thread)。
   * 返回路由所需的 owner 视图与派工所需的已绑定线程。
   */
  async function bindThreads(
    tx: Db,
    req: WorkRequest,
    project: string | null,
    at: number,
  ): Promise<{ threadKeys: string[]; owners: OwnerView[]; boundThreads: DispatchContext["boundThreads"] }> {
    const owners: OwnerView[] = [];
    const boundThreads: { threadId: string; threadKey: string }[] = [];
    const threadKeys: string[] = [];
    const seenThreadKeys = new Set<string>();
    for (const ref of req.threadRefs) {
      const key = threadKeyOf(ref);
      if (seenThreadKeys.has(key)) {
        continue;
      }
      seenThreadKeys.add(key);
      threadKeys.push(key);
      let thread = await findWorkThreadByKey(tx, ref.source, ref.externalKind, ref.externalKey);
      if (thread === undefined) {
        if (project === null) {
          continue;
        }
        await insertWorkThreadIfNew(tx, {
          id: newThreadId(),
          source: ref.source,
          externalKind: ref.externalKind,
          externalKey: ref.externalKey,
          project,
          createdAt: at,
        });
        thread = await findWorkThreadByKey(tx, ref.source, ref.externalKind, ref.externalKey);
        if (thread === undefined) {
          throw new Error(`Thread 建联后回读失败: ${key}`);
        }
      }
      await touchWorkThreadTrigger(tx, thread.id, at);
      boundThreads.push({ threadId: thread.id, threadKey: key });
      const ownerSub = await findActiveOwnerSubscription(tx, thread.id);
      if (ownerSub !== undefined) {
        const item = await findWorkItemById(tx, ownerSub.workItemId);
        owners.push({
          threadKey: key,
          workItemId: ownerSub.workItemId,
          itemStatus: item?.status ?? "cancelled",
        });
      }
    }
    return { threadKeys, owners, boundThreads };
  }

  async function ingest(req: WorkRequest): Promise<IngestResult> {
    validate(req);
    const at = now();
    const triggerId = newTriggerId();
    const project = req.project?.trim() || null;
    const threadRefsJson = JSON.stringify(req.threadRefs);

    return db.transaction(async (tx) => {
      const inserted = await insertWorkTriggerIfNew(tx, {
        id: triggerId,
        source: req.source,
        sourceEventId: req.sourceEventId,
        kind: req.kind,
        actorJson: JSON.stringify(req.actor),
        project,
        threadRefsJson,
        payloadJson: JSON.stringify(req.payload),
        refsJson: JSON.stringify(req.refs),
        authorizationRef: req.authorizationRef?.trim() || null,
        occurredAt: req.occurredAt,
        receivedAt: at,
      });
      if (!inserted) {
        const existing = await findWorkTriggerBySourceEvent(tx, req.source, req.sourceEventId);
        if (existing === undefined) {
          throw new Error(`触发事实插入冲突后回读失败: ${req.source}/${req.sourceEventId}`);
        }
        const workItem =
          existing.workItemId === null
            ? undefined
            : await findWorkItemById(tx, existing.workItemId);
        return { replayed: true, trigger: existing, workItem, inboxIds: [] };
      }

      const { threadKeys, owners, boundThreads } = await bindThreads(tx, req, project, at);
      const outcome = routeTrigger(
        policy,
        { source: req.source, kind: req.kind, project, threadKeys },
        owners,
      );

      const ctx: DispatchContext = {
        request: req,
        triggerId,
        at,
        project: project ?? "",
        authorizationRef: req.authorizationRef?.trim() || null,
        refsJson: JSON.stringify(req.refs),
        threadRefsJson,
        boundThreads,
      };
      let dispatched: DispatchOutcome;
      if (outcome.decision === "owner_continue") {
        dispatched = await dispatchOwnerContinue(tx, ctx, dispatchDeps, outcome);
      } else if (outcome.decision === "assign") {
        dispatched = await dispatchAssign(tx, ctx, dispatchDeps, outcome);
      } else {
        dispatched = {
          resolved: {
            disposition: "needs_person",
            reasonCode: outcome.reasonCode,
            ruleId: null,
            ruleVersion: null,
            workItemId: null,
            targetAgentId: null,
          },
          newInboxIds: [],
        };
      }

      await saveTriggerDisposition(tx, { id: triggerId, ...dispatched.resolved });
      const trigger = await findWorkTriggerBySourceEvent(tx, req.source, req.sourceEventId);
      if (trigger === undefined) {
        throw new Error("触发事实处置落账后回读失败");
      }
      const workItem =
        dispatched.resolved.workItemId === null
          ? undefined
          : await findWorkItemById(tx, dispatched.resolved.workItemId);
      return { replayed: false, trigger, workItem, inboxIds: dispatched.newInboxIds };
    });
  }

  return { ingest };
}
