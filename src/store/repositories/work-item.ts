import type { Db } from "../database.js";
import type {
  WorkItemAttention,
  WorkItemStage,
  WorkItemStatus,
} from "../../shared/constants.js";

export interface WorkItemRecord {
  id: string;
  parentWorkItemId: string | null;
  project: string;
  kind: string;
  title: string;
  expectedResult: string;
  scopeJson: string;
  status: WorkItemStatus;
  stage: WorkItemStage;
  attention: WorkItemAttention;
  originTriggerId: string | null;
  authorizationKind: string;
  authorizationRef: string | null;
  policyVersion: string;
  nextAction: string | null;
  latestSummary: string | null;
  lastProgressAt: number | null;
  progressRevision: number;
  output: string | null;
  validationJson: string | null;
  acceptanceRef: string | null;
  createdAt: number;
  updatedAt: number;
  endedAt: number | null;
}

const FULL_COLUMNS = `
  id, parent_work_item_id AS "parentWorkItemId", project, kind, title,
  expected_result AS "expectedResult", scope_json AS "scopeJson",
  status, stage, attention, origin_trigger_id AS "originTriggerId",
  authorization_kind AS "authorizationKind", authorization_ref AS "authorizationRef",
  policy_version AS "policyVersion", next_action AS "nextAction",
  latest_summary AS "latestSummary", last_progress_at AS "lastProgressAt",
  progress_revision AS "progressRevision", output, validation_json AS "validationJson",
  acceptance_ref AS "acceptanceRef", created_at AS "createdAt",
  updated_at AS "updatedAt", ended_at AS "endedAt"
`;

/** Mandate 列(expected_result / scope_json / authorization_* / policy_version)随创建一次性快照,之后不更新 */
export interface NewWorkItem {
  id: string;
  project: string;
  kind: string;
  title: string;
  expectedResult: string;
  scopeJson: string;
  originTriggerId: string | null;
  authorizationKind: string;
  authorizationRef: string | null;
  policyVersion: string;
  createdAt: number;
}

export async function insertWorkItem(db: Db, row: NewWorkItem): Promise<void> {
  await db.run(
    `INSERT INTO work_item
       (id, project, kind, title, expected_result, scope_json, origin_trigger_id,
        authorization_kind, authorization_ref, policy_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.project,
    row.kind,
    row.title,
    row.expectedResult,
    row.scopeJson,
    row.originTriggerId,
    row.authorizationKind,
    row.authorizationRef,
    row.policyVersion,
    row.createdAt,
    row.createdAt,
  );
}

export async function findWorkItemById(db: Db, id: string): Promise<WorkItemRecord | undefined> {
  return (await db.get(`SELECT ${FULL_COLUMNS} FROM work_item WHERE id = ?`, id)) as
    | WorkItemRecord
    | undefined;
}

export interface NewWorkItemEvent {
  id: string;
  workItemId: string;
  kind: string;
  triggerId: string | null;
  evidenceRefsJson: string;
  payloadJson: string;
  occurredAt: number;
}

export interface WorkItemEventRecord {
  id: string;
  workItemId: string;
  seq: number;
  kind: string;
  triggerId: string | null;
  evidenceRefsJson: string;
  payloadJson: string;
  occurredAt: number;
}

/** seq 由服务端按事项内单调分配(照 task_event MAX+1 模式),append-only 只插入 */
export async function appendWorkItemEvent(db: Db, entry: NewWorkItemEvent): Promise<void> {
  const { seq } = (await db.get(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM work_item_event WHERE work_item_id = ?',
    entry.workItemId,
  )) as { seq: number };
  await db.run(
    `INSERT INTO work_item_event (id, work_item_id, seq, kind, trigger_id, evidence_refs_json, payload_json, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    entry.id,
    entry.workItemId,
    seq,
    entry.kind,
    entry.triggerId,
    entry.evidenceRefsJson,
    entry.payloadJson,
    entry.occurredAt,
  );
}

export async function listWorkItemEvents(
  db: Db,
  workItemId: string,
): Promise<WorkItemEventRecord[]> {
  const rows = (await db.all(
    `SELECT id, work_item_id AS "workItemId", seq, kind, trigger_id AS "triggerId",
            evidence_refs_json AS "evidenceRefsJson", payload_json AS "payloadJson",
            occurred_at AS "occurredAt"
       FROM work_item_event WHERE work_item_id = ? ORDER BY seq ASC`,
    workItemId,
  )) as WorkItemEventRecord[];
  return rows;
}

export interface WorkItemProjectionPatch {
  id: string;
  stage?: WorkItemStage;
  attention?: WorkItemAttention;
  nextAction: string | null;
  updatedAt: number;
}

/** 末态投影:事件写入的同一事务内更新,读路径不扫事件(arch/02 §3.9) */
export async function updateWorkItemProjection(db: Db, patch: WorkItemProjectionPatch): Promise<boolean> {
  const stageClause = patch.stage === undefined ? "" : "stage = ?,";
  const attentionClause = patch.attention === undefined ? "" : "attention = ?,";
  const params: unknown[] = [];
  if (patch.stage !== undefined) {
    params.push(patch.stage);
  }
  if (patch.attention !== undefined) {
    params.push(patch.attention);
  }
  params.push(patch.nextAction, patch.updatedAt, patch.id);
  return (
    (
      await db.run(
        `UPDATE work_item SET ${stageClause} ${attentionClause} next_action = ?, updated_at = ?
          WHERE id = ?`,
        ...params,
      )
    ).changes === 1
  );
}
