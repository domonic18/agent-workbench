import type {
  TaskEventKind,
  TaskOrigin,
  TaskStage,
  TaskStatus,
} from "../../shared/constants.js";
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

export interface TaskRecord {
  id: string;
  title: string;
  assigner: string;
  assignee: string;
  project: string;
  parentTaskId: string | null;
  round: number;
  reworkCount: number;
  stage: TaskStage;
  status: TaskStatus;
  origin: TaskOrigin;
  deadlineAt: number | null;
  output: string | null;
  startedAt: number | null;
  endedAt: number | null;
  totalTokens: number;
  createdAt: number;
  updatedAt: number;
}

const FULL_COLUMNS = `
  id, title, assigner, assignee, project, parent_task_id AS parentTaskId,
  round, rework_count AS reworkCount, stage, status, origin,
  deadline_at AS deadlineAt, output, started_at AS startedAt, ended_at AS endedAt,
  total_tokens AS totalTokens, created_at AS createdAt, updated_at AS updatedAt
`;

export interface NewTask {
  id: string;
  title: string;
  assigner: string;
  assignee: string;
  project: string;
  parentTaskId: string | null;
  origin: TaskOrigin;
  deadlineAt: number | null;
  output: string | null;
  createdAt: number;
}

/** 新任务恒从 intake/pending 起跑,round、rework_count、total_tokens 由表默认值兜底 */
export function insertTask(db: Db, task: NewTask): void {
  db.prepare(
    `INSERT INTO task
       (id, title, assigner, assignee, project, parent_task_id, round, rework_count,
        stage, status, origin, deadline_at, output, started_at, ended_at, total_tokens,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, 'intake', 'pending', ?, ?, ?, NULL, NULL, 0, ?, ?)`,
  ).run(
    task.id,
    task.title,
    task.assigner,
    task.assignee,
    task.project,
    task.parentTaskId,
    task.origin,
    task.deadlineAt,
    task.output,
    task.createdAt,
    task.createdAt,
  );
}

export function findTaskById(db: Db, id: string): TaskRecord | undefined {
  return db.prepare(`SELECT ${FULL_COLUMNS} FROM task WHERE id = ?`).get(id) as
    | TaskRecord
    | undefined;
}

export interface TaskUpdatePatch {
  id: string;
  fromStage: TaskStage;
  fromStatus: TaskStatus;
  stage: TaskStage;
  status: TaskStatus;
  reworkCount: number;
  output: string | null;
  deadlineAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  updatedAt: number;
}

/** CAS:以读到的 stage/status 作 WHERE,并发下只有一方成功,另一方按冲突回到上层 */
export function updateTask(db: Db, patch: TaskUpdatePatch): boolean {
  return (
    db
      .prepare(
        `UPDATE task
            SET stage = @stage, status = @status, rework_count = @reworkCount,
                output = @output, deadline_at = @deadlineAt, started_at = @startedAt,
                ended_at = @endedAt, updated_at = @updatedAt
          WHERE id = @id AND stage = @fromStage AND status = @fromStatus`,
      )
      .run({
        id: patch.id,
        fromStage: patch.fromStage,
        fromStatus: patch.fromStatus,
        stage: patch.stage,
        status: patch.status,
        reworkCount: patch.reworkCount,
        output: patch.output,
        deadlineAt: patch.deadlineAt,
        startedAt: patch.startedAt,
        endedAt: patch.endedAt,
        updatedAt: patch.updatedAt,
      }).changes === 1
  );
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
