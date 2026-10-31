import type { TaskEventKind } from "../../shared/constants.js";
import type { Db } from "../database.js";

export interface TaskSummary {
  id: string;
  title: string;
  assigner: string;
  assignee: string;
  project: string;
  stage: string;
  status: string;
  deadlineAt: number | null;
  totalTokens: number;
}

const COLUMNS = `
  id, title, assigner, assignee, project, stage, status,
  deadline_at AS deadlineAt, total_tokens AS totalTokens
`;

/** 只读摘要,供指令回执与控制台列表使用;完整任务聚合等 M2.5 建单后再补 */
export function listTaskSummaries(db: Db, limit: number): TaskSummary[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM task ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(limit) as TaskSummary[];
}

export function findTaskSummary(db: Db, id: string): TaskSummary | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM task WHERE id = ?`).get(id) as TaskSummary | undefined;
}

/** 归属谓词 = task.assignee;供 A2A 发送方校验「task_id 恒指自己的任务」 */
export function findTaskOwnedBy(
  db: Db,
  id: string,
  assignee: string,
): TaskSummary | undefined {
  return db
    .prepare(`SELECT ${COLUMNS} FROM task WHERE id = ? AND assignee = ?`)
    .get(id, assignee) as TaskSummary | undefined;
}

/** 链路只写一次:创建后不可改,已存在 parent_task_id 时返回 false */
export function setTaskParentIfEmpty(
  db: Db,
  id: string,
  parentTaskId: string,
  now: number,
): boolean {
  return (
    db
      .prepare(
        "UPDATE task SET parent_task_id = ?, updated_at = ? WHERE id = ? AND parent_task_id IS NULL",
      )
      .run(parentTaskId, now, id).changes === 1
  );
}

export function findTaskParent(db: Db, id: string): string | null | undefined {
  const row = db.prepare("SELECT parent_task_id AS parentTaskId FROM task WHERE id = ?").get(id) as
    | { parentTaskId: string | null }
    | undefined;
  return row?.parentTaskId;
}

export interface NewTaskEvent {
  id: string;
  taskId: string;
  kind: TaskEventKind;
  payload?: unknown;
  occurredAt: number;
}

/** seq 由服务端按任务内单调分配,外面只给事件内容 */
export function appendTaskEvent(db: Db, entry: NewTaskEvent): void {
  const { seq } = db
    .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM task_event WHERE task_id = ?")
    .get(entry.taskId) as { seq: number };
  db.prepare(
    `INSERT INTO task_event (id, task_id, seq, kind, payload_json, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(entry.id, entry.taskId, seq, entry.kind, JSON.stringify(entry.payload ?? {}), entry.occurredAt);
}
