import type { Db } from "../database.js";
import type { WorkTriggerDisposition } from "../../shared/constants.js";

export interface WorkTriggerRecord {
  id: string;
  source: string;
  sourceEventId: string;
  kind: string;
  actorJson: string;
  project: string | null;
  threadRefsJson: string;
  payloadJson: string;
  refsJson: string;
  authorizationRef: string | null;
  disposition: WorkTriggerDisposition;
  reasonCode: string | null;
  ruleId: string | null;
  ruleVersion: string | null;
  workItemId: string | null;
  targetAgentId: string | null;
  occurredAt: number;
  receivedAt: number;
}

const FULL_COLUMNS = `
  id, source, source_event_id AS "sourceEventId", kind, actor_json AS "actorJson",
  project, thread_refs_json AS "threadRefsJson", payload_json AS "payloadJson",
  refs_json AS "refsJson", authorization_ref AS "authorizationRef",
  disposition, reason_code AS "reasonCode", rule_id AS "ruleId",
  rule_version AS "ruleVersion", work_item_id AS "workItemId",
  target_agent_id AS "targetAgentId", occurred_at AS "occurredAt",
  received_at AS "receivedAt"
`;

/** 已归一事实(arch/01 §9.1):payload 只存审计所需最小内容,长文与附件以 refs 引用 */
export interface NewWorkTrigger {
  id: string;
  source: string;
  sourceEventId: string;
  kind: string;
  actorJson: string;
  project: string | null;
  threadRefsJson: string;
  payloadJson: string;
  refsJson: string;
  authorizationRef: string | null;
  occurredAt: number;
  receivedAt: number;
}

/**
 * 首到先得(照 feishu_event ON CONFLICT DO NOTHING 模式):
 * 插入成功返回 true;同一 (source, source_event_id) 重放返回 false,
 * 由调用方回读首次处置,不重复开工。
 */
export async function insertWorkTriggerIfNew(
  db: Db,
  row: NewWorkTrigger,
): Promise<boolean> {
  const inserted = await db.run(
    `INSERT INTO work_trigger
       (id, source, source_event_id, kind, actor_json, project, thread_refs_json,
        payload_json, refs_json, authorization_ref, disposition, occurred_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)
     ON CONFLICT (source, source_event_id) DO NOTHING`,
    row.id,
    row.source,
    row.sourceEventId,
    row.kind,
    row.actorJson,
    row.project,
    row.threadRefsJson,
    row.payloadJson,
    row.refsJson,
    row.authorizationRef,
    row.occurredAt,
    row.receivedAt,
  );
  return inserted.changes === 1;
}

export async function findWorkTriggerBySourceEvent(
  db: Db,
  source: string,
  sourceEventId: string,
): Promise<WorkTriggerRecord | undefined> {
  return (await db.get(
    `SELECT ${FULL_COLUMNS} FROM work_trigger WHERE source = ? AND source_event_id = ?`,
    source,
    sourceEventId,
  )) as WorkTriggerRecord | undefined;
}

/** 按内部 id 回读(origin 触发归属核验用) */
export async function findWorkTriggerById(
  db: Db,
  id: string,
): Promise<WorkTriggerRecord | undefined> {
  return (await db.get(`SELECT ${FULL_COLUMNS} FROM work_trigger WHERE id = ?`, id)) as
    | WorkTriggerRecord
    | undefined;
}

export interface TriggerDispositionPatch {
  id: string;
  disposition: WorkTriggerDisposition;
  reasonCode: string | null;
  ruleId: string | null;
  ruleVersion: string | null;
  workItemId: string | null;
  targetAgentId: string | null;
}

/** 路由处置落账:与派工副作用同一事务,提交后「为什么派给它」只有一个可重放答案 */
export async function saveTriggerDisposition(
  db: Db,
  patch: TriggerDispositionPatch,
): Promise<boolean> {
  return (
    (
      await db.run(
        `UPDATE work_trigger
            SET disposition = ?, reason_code = ?, rule_id = ?, rule_version = ?,
                work_item_id = ?, target_agent_id = ?
          WHERE id = ?`,
        patch.disposition,
        patch.reasonCode,
        patch.ruleId,
        patch.ruleVersion,
        patch.workItemId,
        patch.targetAgentId,
        patch.id,
      )
    ).changes === 1
  );
}
