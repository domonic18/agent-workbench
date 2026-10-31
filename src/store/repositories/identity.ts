import type { IdentityStatus } from "../../shared/constants.js";
import type { Db } from "../database.js";

export interface MachineRecord {
  id: string;
  hostname: string;
  os: string;
  collectorVersion: string;
  collectorSecretHash: string;
  lastSeenAt: number | null;
  status: IdentityStatus;
  createdAt: number;
}

const MACHINE_COLUMNS = `
  id, hostname, os, collector_version AS collectorVersion,
  collector_secret_hash AS collectorSecretHash, last_seen_at AS lastSeenAt,
  status, created_at AS createdAt
`;

export interface NewMachine {
  id: string;
  hostname: string;
  os: string;
  collectorVersion: string;
  collectorSecretHash: string;
  createdAt: number;
}

export function insertMachine(db: Db, row: NewMachine): void {
  db.prepare(
    `INSERT INTO machine
       (id, hostname, os, collector_version, collector_secret_hash, status, created_at)
     VALUES (@id, @hostname, @os, @collectorVersion, @collectorSecretHash, 'active', @createdAt)`,
  ).run(row);
}

export function findMachineById(db: Db, id: string): MachineRecord | undefined {
  return db.prepare(`SELECT ${MACHINE_COLUMNS} FROM machine WHERE id = ?`).get(id) as
    | MachineRecord
    | undefined;
}

export function updateMachineSecretHash(db: Db, id: string, hash: string): boolean {
  return db.prepare("UPDATE machine SET collector_secret_hash = ? WHERE id = ?").run(hash, id)
    .changes === 1;
}

export interface MachineListQuery {
  limit: number;
  /** keyset 游标:上一页最后一行的 (createdAt, id) */
  before?: { createdAt: number; id: string };
}

export function listMachines(db: Db, query: MachineListQuery): MachineRecord[] {
  const params: Record<string, unknown> = { limit: query.limit };
  let where = "";
  if (query.before !== undefined) {
    where =
      "WHERE created_at < @beforeCreatedAt OR (created_at = @beforeCreatedAt AND id < @beforeId)";
    params.beforeCreatedAt = query.before.createdAt;
    params.beforeId = query.before.id;
  }
  return db
    .prepare(
      `SELECT ${MACHINE_COLUMNS} FROM machine ${where} ORDER BY created_at DESC, id DESC LIMIT @limit`,
    )
    .all(params) as MachineRecord[];
}

export interface AgentRecord {
  id: string;
  machineId: string;
  project: string;
  displayName: string;
  secretHash: string;
  feishuAppId: string | null;
  status: IdentityStatus;
  allowedTargetsJson: string;
  createdAt: number;
  updatedAt: number;
}

const AGENT_COLUMNS = `
  id, machine_id AS machineId, project, display_name AS displayName,
  secret_hash AS secretHash, feishu_app_id AS feishuAppId, status,
  allowed_targets_json AS allowedTargetsJson, created_at AS createdAt, updated_at AS updatedAt
`;

export interface NewAgent {
  id: string;
  machineId: string;
  project: string;
  displayName: string;
  secretHash: string;
  feishuAppId: string | null;
  allowedTargetsJson: string;
  createdAt: number;
}

export function insertAgent(db: Db, row: NewAgent): void {
  db.prepare(
    `INSERT INTO agent
       (id, machine_id, project, display_name, secret_hash, feishu_app_id, status,
        allowed_targets_json, created_at, updated_at)
     VALUES (@id, @machineId, @project, @displayName, @secretHash, @feishuAppId, 'active',
        @allowedTargetsJson, @createdAt, @createdAt)`,
  ).run(row);
}

export function findAgentById(db: Db, id: string): AgentRecord | undefined {
  return db.prepare(`SELECT ${AGENT_COLUMNS} FROM agent WHERE id = ?`).get(id) as
    | AgentRecord
    | undefined;
}

export function findAgentByMachineProject(
  db: Db,
  machineId: string,
  project: string,
): AgentRecord | undefined {
  return db
    .prepare(`SELECT ${AGENT_COLUMNS} FROM agent WHERE machine_id = ? AND project = ?`)
    .get(machineId, project) as AgentRecord | undefined;
}

export function updateAgentSecretHash(db: Db, id: string, hash: string, now: number): boolean {
  return db
    .prepare("UPDATE agent SET secret_hash = ?, updated_at = ? WHERE id = ?")
    .run(hash, now, id).changes === 1;
}

export interface AgentListQuery {
  limit: number;
  before?: { createdAt: number; id: string };
}

export function listAgents(db: Db, query: AgentListQuery): AgentRecord[] {
  const params: Record<string, unknown> = { limit: query.limit };
  let where = "";
  if (query.before !== undefined) {
    where =
      "WHERE created_at < @beforeCreatedAt OR (created_at = @beforeCreatedAt AND id < @beforeId)";
    params.beforeCreatedAt = query.before.createdAt;
    params.beforeId = query.before.id;
  }
  return db
    .prepare(
      `SELECT ${AGENT_COLUMNS} FROM agent ${where} ORDER BY created_at DESC, id DESC LIMIT @limit`,
    )
    .all(params) as AgentRecord[];
}
