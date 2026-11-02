import { newPrefixedId } from "../../shared/ids.js";
import type { Db } from "../../store/database.js";
import {
  appendTaskEvent,
  findTaskById,
  findTaskParent,
  updateTask,
  type TaskRecord,
} from "../../store/repositories/task.js";

/**
 * 根任务自动收口(2026-11-02 裁决):下游全部终态且所有回执已确认时,
 * 系统把委派根任务推进到 done——验收语义 = 发起方 ACK 回执,不依赖 Agent 记性关单。
 * pending 根任务按合法路径 pending→running→done 补齐跃迁,全部落在调用方事务内。
 */

interface ChildStatus {
  id: string;
  status: string;
}

function findChildren(db: Db, parentId: string): ChildStatus[] {
  return db
    .prepare(`SELECT id, status FROM task WHERE parent_task_id = ?`)
    .all(parentId) as ChildStatus[];
}

function hasUnackedReplies(db: Db, childIds: string[]): boolean {
  const placeholders = childIds.map(() => "?").join(", ");
  const row = db
    .prepare(
      `SELECT 1 FROM a2a_message
        WHERE intent = 'reply' AND ack_at IS NULL AND task_id IN (${placeholders})
        LIMIT 1`,
    )
    .get(...childIds);
  return row !== undefined;
}

/** pending 根任务先补 running(系统代推进),再落 done;两级都走 CAS,事件记 system actor */
function closeOne(db: Db, parent: TaskRecord, at: number): TaskRecord {
  const patch = (fromStatus: TaskRecord["status"], toStatus: TaskRecord["status"]) => {
    const applied = updateTask(db, {
      id: parent.id,
      fromStage: parent.stage,
      fromStatus,
      stage: parent.stage,
      status: toStatus,
      reworkCount: parent.reworkCount,
      output: parent.output,
      deadlineAt: parent.deadlineAt,
      startedAt: parent.startedAt ?? at,
      endedAt: at,
      updatedAt: at,
    });
    if (!applied) {
      throw new Error(`根任务 ${parent.id} 自动收口被并发修改,中止本轮收口`);
    }
  };
  if (parent.status === "pending") {
    patch("pending", "running");
    appendTaskEvent(db, {
      id: newPrefixedId("tev"),
      taskId: parent.id,
      kind: "resumed",
      payload: { from: "pending", to: "running", actor: "system", reason: "auto_close" },
      occurredAt: at,
    });
  }
  patch(parent.status === "pending" ? "running" : parent.status, "done");
  appendTaskEvent(db, {
    id: newPrefixedId("tev"),
    taskId: parent.id,
    kind: "completed",
    payload: { from: parent.status, to: "done", actor: "system", reason: "auto_close" },
    occurredAt: at,
  });
  const closed = findTaskById(db, parent.id);
  if (closed === undefined) {
    throw new Error(`根任务 ${parent.id} 收口后读不到记录`);
  }
  return closed;
}

/** 从 taskId 沿 parent 链向上收口;返回本轮被系统关单的任务(调用方据此发〔验收〕播报) */
export function closeAncestorsIfComplete(db: Db, taskId: string, at: number): TaskRecord[] {
  const closed: TaskRecord[] = [];
  let parentId = findTaskParent(db, taskId);
  while (typeof parentId === "string") {
    const parent = findTaskById(db, parentId);
    if (parent === undefined || parent.status === "done" || parent.status === "cancelled") {
      break;
    }
    const children = findChildren(db, parent.id);
    const allTerminal =
      children.length > 0 &&
      children.every((child) => child.status === "done" || child.status === "cancelled");
    if (!allTerminal || hasUnackedReplies(db, children.map((child) => child.id))) {
      break;
    }
    closed.push(closeOne(db, parent, at));
    parentId = findTaskParent(db, parent.id);
  }
  return closed;
}
