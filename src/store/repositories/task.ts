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
  deadline_at AS "deadlineAt", total_tokens AS "totalTokens"
`;

/** 只读摘要,供指令回执与控制台列表使用;完整任务聚合等 M2.5 建单后再补 */
export async function listTaskSummaries(db: Db, limit: number): Promise<TaskSummary[]> {
  return (await db.all(
    `SELECT ${COLUMNS} FROM task ORDER BY created_at DESC, id DESC LIMIT ?`,
    limit,
  )) as TaskSummary[];
}

export async function findTaskSummary(db: Db, id: string): Promise<TaskSummary | undefined> {
  return (await db.get(`SELECT ${COLUMNS} FROM task WHERE id = ?`, id)) as
    | TaskSummary
    | undefined;
}

/** 归属谓词 = task.assignee;供 A2A 发送方校验「task_id 恒指自己的任务」 */
export interface TaskListQuery {
  status?: TaskStatus;
  project?: string;
  assignee?: string;
  limit: number;
  /** keyset 游标:上一页最后一行的 (createdAt, id) */
  before?: { createdAt: number; id: string };
}

/** 控制台任务列表:按键集分页,不扫事件表(02 §4 投影口径) */
export async function listTasks(db: Db, query: TaskListQuery): Promise<TaskRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.status !== undefined) {
    conditions.push("status = ?");
    params.push(query.status);
  }
  if (query.project !== undefined) {
    conditions.push("project = ?");
    params.push(query.project);
  }
  if (query.assignee !== undefined) {
    conditions.push("assignee = ?");
    params.push(query.assignee);
  }
  if (query.before !== undefined) {
    conditions.push(
      "(created_at < ? OR (created_at = ? AND id < ?))",
    );
    params.push(query.before.createdAt, query.before.createdAt, query.before.id);
  }
  params.push(query.limit);
  const limitIdx = `$${params.length}`;
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
  return (await db.all(
    `SELECT ${FULL_COLUMNS} FROM task ${where} ORDER BY created_at DESC, id DESC LIMIT ${limitIdx}`,
    ...params,
  )) as TaskRecord[];
}

export async function findTaskOwnedBy(
  db: Db,
  id: string,
  assignee: string,
): Promise<TaskSummary | undefined> {
  return (await db.get(
    `SELECT ${COLUMNS} FROM task WHERE id = ? AND assignee = ?`,
    id, assignee,
  )) as TaskSummary | undefined;
}

/** 链路只写一次:创建后不可改,已存在 parent_task_id 时返回 false */
export async function setTaskParentIfEmpty(
  db: Db,
  id: string,
  parentTaskId: string,
  now: number,
): Promise<boolean> {
  return (
    (
      await db.run(
        "UPDATE task SET parent_task_id = ?, updated_at = ? WHERE id = ? AND parent_task_id IS NULL",
        parentTaskId, now, id,
      )
    ).changes === 1
  );
}

export async function findTaskParent(db: Db, id: string): Promise<string | null | undefined> {
  const row = (await db.get(
    'SELECT parent_task_id AS "parentTaskId" FROM task WHERE id = ?',
    id,
  )) as { parentTaskId: string | null } | undefined;
  return row?.parentTaskId;
}

export interface TaskEventRecord {
  id: string;
  taskId: string;
  seq: number;
  kind: TaskEventKind;
  payloadJson: string;
  occurredAt: number;
}

const EVENT_COLUMNS = `
  id, task_id AS "taskId", seq, kind, payload_json AS "payloadJson", occurred_at AS "occurredAt"
`;

/** 快照(cursor=0)与增量共用:按 seq 升序,游标之后取 limit 条 */
export async function listTaskEvents(
  db: Db,
  taskId: string,
  afterSeq: number,
  limit: number,
): Promise<TaskEventRecord[]> {
  return (await db.all(
    `SELECT ${EVENT_COLUMNS} FROM task_event
      WHERE task_id = ? AND seq > ?
      ORDER BY seq ASC LIMIT ?`,
    taskId, afterSeq, limit,
  )) as TaskEventRecord[];
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
  id, title, assigner, assignee, project, parent_task_id AS "parentTaskId",
  round, rework_count AS "reworkCount", stage, status, origin,
  deadline_at AS "deadlineAt", output, started_at AS "startedAt", ended_at AS "endedAt",
  total_tokens AS "totalTokens", created_at AS "createdAt", updated_at AS "updatedAt"
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
export async function insertTask(db: Db, task: NewTask): Promise<void> {
  await db.run(
    `INSERT INTO task
       (id, title, assigner, assignee, project, parent_task_id, round, rework_count,
        stage, status, origin, deadline_at, output, started_at, ended_at, total_tokens,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, 'intake', 'pending', ?, ?, ?, NULL, NULL, 0, ?, ?)`,
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

export async function findTaskById(db: Db, id: string): Promise<TaskRecord | undefined> {
  return (await db.get(`SELECT ${FULL_COLUMNS} FROM task WHERE id = ?`, id)) as
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
export async function updateTask(db: Db, patch: TaskUpdatePatch): Promise<boolean> {
  return (
    (
      await db.run(
        `UPDATE task
            SET stage = ?, status = ?, rework_count = ?,
                output = ?, deadline_at = ?, started_at = ?,
                ended_at = ?, updated_at = ?
          WHERE id = ? AND stage = ? AND status = ?`,
        patch.stage,
        patch.status,
        patch.reworkCount,
        patch.output,
        patch.deadlineAt,
        patch.startedAt,
        patch.endedAt,
        patch.updatedAt,
        patch.id,
        patch.fromStage,
        patch.fromStatus,
      )
    ).changes === 1
  );
}

/** seq 由服务端按任务内单调分配,外面只给事件内容 */
export async function appendTaskEvent(db: Db, entry: NewTaskEvent): Promise<void> {
  const { seq } = (await db.get(
    "SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM task_event WHERE task_id = ?",
    entry.taskId,
  )) as { seq: number };
  await db.run(
    `INSERT INTO task_event (id, task_id, seq, kind, payload_json, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    entry.id, entry.taskId, seq, entry.kind, JSON.stringify(entry.payload ?? {}), entry.occurredAt,
  );
}
