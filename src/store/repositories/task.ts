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
