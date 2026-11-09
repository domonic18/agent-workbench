import { randomUUID } from "node:crypto";
import {
  announceAssignmentStalled,
  announceTaskReclaimed,
} from "../../domain/work/notify.js";
import { ZOMBIE_RECLAIM } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import {
  countWorkItemEvents,
  findWorkItemById,
  appendWorkItemEvent,
  markWorkItemAttention,
} from "../../store/repositories/work-item.js";
import {
  findLatestAckedAssignment,
  listStalePendingWorkItemIds,
  requeueAckedAssignment,
} from "../../store/repositories/work-inbox.js";
import {
  appendTaskEvent,
  countLiveTasksForWorkItem,
  listStaleRunningTasks,
  updateTask,
} from "../../store/repositories/task.js";
import type { JobLogger } from "./reconcile.js";

export interface ZombieReclaimer {
  stop(): void;
}

export interface ZombieReclaimDeps {
  db: Db;
  now: () => number;
  /** 协作群;未配置时照常回收,只不播报 */
  chatId: string | undefined;
  newEventId?: () => string;
}

export interface ZombieReclaimTiming {
  /** running 超过该时长未动判僵尸 */
  zombieMs: number;
  /** assignment pending 超过该时长升级停滞 */
  stallMs: number;
}

export interface ZombieReclaimResult {
  blocked: number;
  requeued: number;
  stalled: number;
}

/**
 * 僵尸回收一轮(dispatch-coordination.md §3.3):
 * 1) running 超时 → blocked(ended_at 留空,与善后口径一致)+ 播报;
 * 2) 事项仍 open、assignment 已 acked 且无存活任务 → 重置 pending 重排,
 *    同一事项重排计数走 kind='requeued' 事件,达上限改标 attention=stalled;
 * 3) assignment pending 超时 → attention=stalled + 升级播报(置位翻转只播一次)。
 */
export async function reclaimZombiesOnce(
  deps: ZombieReclaimDeps,
  timing: ZombieReclaimTiming,
  logger: JobLogger,
): Promise<ZombieReclaimResult> {
  const now = deps.now();
  const newEventId = deps.newEventId ?? randomUUID;
  const result: ZombieReclaimResult = { blocked: 0, requeued: 0, stalled: 0 };

  const stale = await listStaleRunningTasks(deps.db, now - timing.zombieMs);
  for (const task of stale) {
    await deps.db.transaction(async (tx) => {
      // CAS running→blocked:并发或重扫下只有一方生效,天然幂等
      const blocked = await updateTask(tx, {
        id: task.id,
        fromStage: task.stage,
        fromStatus: task.status,
        stage: task.stage,
        status: "blocked",
        reworkCount: task.reworkCount,
        output: task.output,
        deadlineAt: task.deadlineAt,
        startedAt: task.startedAt,
        endedAt: task.endedAt,
        updatedAt: now,
      });
      if (!blocked) {
        return;
      }
      result.blocked += 1;
      await appendTaskEvent(tx, {
        id: newEventId(),
        taskId: task.id,
        kind: "blocked",
        payload: { reason: "zombie_reclaim" },
        occurredAt: now,
      });

      if (task.workItemId === null) {
        await announceTaskReclaimed(tx, {
          agentId: task.assignee,
          taskId: task.id,
          outcome: "skipped",
          attempt: 0,
          chatId: deps.chatId,
          now,
        });
        return;
      }
      const item = await findWorkItemById(tx, task.workItemId);
      if (item === undefined || item.status !== "open") {
        await announceTaskReclaimed(tx, {
          agentId: task.assignee,
          taskId: task.id,
          outcome: "skipped",
          attempt: 0,
          chatId: deps.chatId,
          now,
        });
        return;
      }
      const assignment = await findLatestAckedAssignment(tx, task.workItemId);
      const hasLiveTask = (await countLiveTasksForWorkItem(tx, task.workItemId)) > 0;
      if (assignment === undefined || hasLiveTask) {
        await announceTaskReclaimed(tx, {
          agentId: task.assignee,
          taskId: task.id,
          outcome: "skipped",
          attempt: 0,
          chatId: deps.chatId,
          now,
        });
        return;
      }
      const attempt = (await countWorkItemEvents(tx, task.workItemId, "requeued")) + 1;
      if (attempt > ZOMBIE_RECLAIM.maxRequeue) {
        await markWorkItemAttention(
          tx,
          item.id,
          "stalled",
          `自动重排达上限(${ZOMBIE_RECLAIM.maxRequeue} 次),待人工裁决`,
          now,
        );
        await appendWorkItemEvent(tx, {
          id: newEventId(),
          workItemId: item.id,
          kind: "stalled",
          triggerId: null,
          evidenceRefsJson: "[]",
          payloadJson: JSON.stringify({ task_id: task.id, reason: "requeue_exhausted" }),
          occurredAt: now,
        });
        result.stalled += 1;
        await announceTaskReclaimed(tx, {
          agentId: assignment.targetAgentId,
          taskId: task.id,
          outcome: "stalled",
          attempt,
          chatId: deps.chatId,
          now,
        });
        return;
      }
      await requeueAckedAssignment(tx, assignment.id, now);
      await appendWorkItemEvent(tx, {
        id: newEventId(),
        workItemId: item.id,
        kind: "requeued",
        triggerId: null,
        evidenceRefsJson: "[]",
        payloadJson: JSON.stringify({ inbox_id: assignment.id, task_id: task.id, attempt }),
        occurredAt: now,
      });
      result.requeued += 1;
      await announceTaskReclaimed(tx, {
        agentId: assignment.targetAgentId,
        taskId: task.id,
        outcome: "requeued",
        attempt,
        chatId: deps.chatId,
        now,
      });
    });
  }

  const stalePending = await listStalePendingWorkItemIds(deps.db, now - timing.stallMs);
  for (const workItemId of stalePending) {
    await deps.db.transaction(async (tx) => {
      const item = await findWorkItemById(tx, workItemId);
      if (item === undefined || item.status !== "open") {
        return;
      }
      const flipped = await markWorkItemAttention(
        tx,
        workItemId,
        "stalled",
        "派工长时间无人领取,待人工裁决",
        now,
      );
      if (!flipped) {
        return;
      }
      await appendWorkItemEvent(tx, {
        id: newEventId(),
        workItemId,
        kind: "stalled",
        triggerId: null,
        evidenceRefsJson: "[]",
        payloadJson: JSON.stringify({ reason: "assignment_stalled" }),
        occurredAt: now,
      });
      result.stalled += 1;
      await announceAssignmentStalled(tx, { workItemId, chatId: deps.chatId, now });
    });
  }

  if (result.blocked > 0 || result.requeued > 0 || result.stalled > 0) {
    logger.info(result, "僵尸任务回收巡检");
  }
  return result;
}

export interface ZombieReclaimerOptions extends ZombieReclaimTiming {
  intervalMs?: number;
}

export function startZombieReclaimer(
  deps: ZombieReclaimDeps,
  logger: JobLogger,
  options: ZombieReclaimerOptions,
): ZombieReclaimer {
  const sweep = (): void => {
    void reclaimZombiesOnce(deps, options, logger).catch((error) => {
      logger.error({ err: error }, "僵尸任务回收失败");
    });
  };

  sweep();
  const timer = setInterval(sweep, options.intervalMs ?? ZOMBIE_RECLAIM.pollMs);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
