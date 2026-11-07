import { newPrefixedId } from "../../shared/ids.js";
import { TASK_LIMITS, WORK_INBOX } from "../../shared/constants.js";import type { Db } from "../../store/database.js";
import { findTaskById } from "../../store/repositories/task.js";
import {
  appendWorkItemEvent,
  findWorkItemById,
  listWorkItemEvents,
  type WorkItemEventRecord,
  type WorkItemRecord,
} from "../../store/repositories/work-item.js";
import {
  ackInbox,
  claimPendingForAgent,
  findInboxById,
  handbackInbox,
  hasOpenInboxForAgent,
  listPendingForAgent,
  type WorkerInboxRecord,
} from "../../store/repositories/work-inbox.js";
import { WorkError } from "./errors.js";
import { notifyWorkEvent } from "./notify.js";

export interface WorkerInboxView {
  readonly inbox: WorkerInboxRecord;
  readonly workItem: WorkItemRecord;
}

export interface WorkerService {
  /** 读自己承接的事项与事件历史;读权限=inbox 有指向自己的未退回行(arch/01 §9.3) */
  read(agentId: string, workItemId: string): Promise<{ item: WorkItemRecord; events: WorkItemEventRecord[] }>;
  /** 领取本 Agent 的待处理行;waitMs 内无行则长轮询,租约时长 WORK_INBOX.leaseMs;peek 只看不领不等待 */
  inbox(
    agentId: string,
    opts: { waitMs?: number | undefined; peek?: boolean | undefined },
  ): Promise<WorkerInboxView[]>;
  /** assignment 必带承接 task_id(归属+origin+事项一致均校验);input 仅消费 */
  ack(agentId: string, inboxId: string, taskId: string | null): Promise<void>;
  /** 单事件退回:只释放该 Trigger 归属,不退订 Thread;理由落事项事件 */
  handback(agentId: string, inboxId: string, reason: string): Promise<void>;
}

export interface WorkerServiceDeps {
  db: Db;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  newEventId?: () => string;
  /** 控制台协作群;事项状态卡片发到这里,未配置时不入队 */
  collabChatId?: string | undefined;
}

export function createWorkerService(deps: WorkerServiceDeps): WorkerService {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const newEventId = deps.newEventId ?? (() => newPrefixedId("wev"));

  async function loadOwnedInbox(agentId: string, inboxId: string): Promise<WorkerInboxRecord> {
    const row = await findInboxById(db, inboxId);
    if (row === undefined) {
      throw new WorkError("NOT_FOUND", `inbox ${inboxId} 不存在`);
    }
    if (row.targetAgentId !== agentId) {
      throw new WorkError("FORBIDDEN", "该 inbox 不是发给当前 Agent 的");
    }
    return row;
  }

  async function read(
    agentId: string,
    workItemId: string,
  ): Promise<{ item: WorkItemRecord; events: WorkItemEventRecord[] }> {
    const item = await findWorkItemById(db, workItemId);
    if (item === undefined) {
      throw new WorkError("NOT_FOUND", `工作事项 ${workItemId} 不存在`);
    }
    if (!(await hasOpenInboxForAgent(db, workItemId, agentId))) {
      throw new WorkError("FORBIDDEN", "当前 Agent 未承接该工作事项,知道 ID 不等于有权读");
    }
    return { item, events: await listWorkItemEvents(db, workItemId) };
  }

  async function inbox(
    agentId: string,
    opts: { waitMs?: number | undefined; peek?: boolean | undefined },
  ): Promise<WorkerInboxView[]> {
    // peek 只看不领(照 a2a peek 先例):调度器预检不占租约,Agent 会话随后照常领取
    if (opts.peek === true) {
      const rows = await listPendingForAgent(db, agentId);
      const views: WorkerInboxView[] = [];
      for (const row of rows) {
        const item = await findWorkItemById(db, row.workItemId);
        if (item !== undefined) {
          views.push({ inbox: row, workItem: item });
        }
      }
      return views;
    }
    const deadline = now() + (opts.waitMs ?? 0);
    for (;;) {
      const at = now();
      const claimed = await claimPendingForAgent(db, agentId, at, at + WORK_INBOX.leaseMs);
      if (claimed.length > 0) {
        const views: WorkerInboxView[] = [];
        for (const row of claimed) {
          const item = await findWorkItemById(db, row.workItemId);
          if (item !== undefined) {
            views.push({ inbox: row, workItem: item });
          }
        }
        return views;
      }
      const remaining = deadline - now();
      if (remaining <= 0) {
        return [];
      }
      await sleep(Math.min(WORK_INBOX.probeMs, remaining));
    }
  }

  async function ack(agentId: string, inboxId: string, taskId: string | null): Promise<void> {
    const row = await loadOwnedInbox(agentId, inboxId);
    if (row.status !== "claimed") {
      throw new WorkError(
        "CONFLICT",
        `inbox 状态为 ${row.status},只有 claimed 可 ACK;租约过期已被重投时请按新行重新处理`,
      );
    }

    let boundTaskId: string | null = null;
    if (row.kind === "assignment") {
      if (taskId === null) {
        throw new WorkError("VALIDATION_FAILED", "assignment ACK 必须携带承接的 task_id");
      }
      const task = await findTaskById(db, taskId);
      if (task === undefined) {
        throw new WorkError("NOT_FOUND", `任务 ${taskId} 不存在`);
      }
      if (task.assignee !== agentId) {
        throw new WorkError("FORBIDDEN", "只能用自己的任务承接 assignment");
      }
      if (task.origin !== "work_item") {
        throw new WorkError("VALIDATION_FAILED", `任务 ${taskId} 不是由工作事项派生(origin=${task.origin})`);
      }
      if (task.workItemId !== row.workItemId) {
        throw new WorkError("VALIDATION_FAILED", "任务关联的事项与 inbox 指向的事项不一致");
      }
      boundTaskId = taskId;
    } else if (taskId !== null) {
      throw new WorkError("VALIDATION_FAILED", "input 是续接上下文,ACK 不带 task_id");
    }

    // 校验失败不 handback:行保持 claimed,租约到期由回收作业重投(01 §10)。
    // 状态 CAS 与 task_bound 事件同事务:崩溃不产生「已 ack 却无事件」的断档
    await db.transaction(async (tx) => {
      const applied = await ackInbox(tx, row.id, row.leaseToken, boundTaskId, now());
      if (!applied) {
        throw new WorkError("CONFLICT", "ACK 未生效:租约已过期并被重投,请按新行重新处理");
      }
      if (row.kind === "assignment" && boundTaskId !== null) {
        const eventId = newEventId();
        await appendWorkItemEvent(tx, {
          id: eventId,
          workItemId: row.workItemId,
          kind: "task_bound",
          triggerId: row.triggerId,
          evidenceRefsJson: "[]",
          payloadJson: JSON.stringify({ inbox_id: row.id, task_id: boundTaskId }),
          occurredAt: now(),
        });
        await notifyWorkEvent(tx, {
          workItemId: row.workItemId,
          eventId,
          kind: "task_bound",
          chatId: deps.collabChatId,
          now: now(),
        });
      }
    });
  }

  async function handback(agentId: string, inboxId: string, reason: string): Promise<void> {
    const trimmed = reason.trim();
    if (trimmed === "") {
      throw new WorkError("VALIDATION_FAILED", "handback 必须说明退回理由");
    }
    const row = await loadOwnedInbox(agentId, inboxId);
    if (row.status !== "claimed") {
      throw new WorkError("CONFLICT", `inbox 状态为 ${row.status},只有 claimed 可退回`);
    }
    // CAS 与 handback 事件同事务,理由与状态不脱节
    await db.transaction(async (tx) => {
      const applied = await handbackInbox(
        tx,
        row.id,
        row.leaseToken,
        trimmed.slice(0, TASK_LIMITS.reason),
        now(),
      );
      if (!applied) {
        throw new WorkError("CONFLICT", "退回未生效:租约已过期并被重投");
      }
      await appendWorkItemEvent(tx, {
        id: newEventId(),
        workItemId: row.workItemId,
        kind: "handback",
        triggerId: row.triggerId,
        evidenceRefsJson: "[]",
        payloadJson: JSON.stringify({ inbox_id: row.id, inbox_kind: row.kind, reason: trimmed }),
        occurredAt: now(),
      });
    });
  }

  return { read, inbox, ack, handback };
}
