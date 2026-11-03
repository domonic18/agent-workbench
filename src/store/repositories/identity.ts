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

export function insertMachine(db: Db, row: NewMachine): Promise<void>{
  await db.run(``INSERT INTO machine
       (id, hostname, os, collector_version, collector_secret_hash, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,`, row.id, row.hostname, row.os, row.collectorVersion, row.collectorSecretHash, row.createdAt);
}

export function findMachineById(db: Db, id: string): Promise<MachineRecord | undefined>{
  return await db.get(`SELECT ${MACHINE_COLUMNS} FROM machine WHERE id = ?`, id) as
    | MachineRecord
    | undefined;
}

export function updateMachineSecretHash(db: Db, id: string, hash: string): Promise<boolean>{
  return await db.run("UPDATE machine SET collector_secret_hash = ? WHERE id = ?", hash, id)
    .changes === 1;
}

/** 采集器心跳只推进机器存活时间;机器活着不等于 Agent 在跑 */
export function touchMachineLastSeen(db: Db, id: string, now: number): Promise<boolean>{
  return (await db.run("UPDATE machine SET last_seen_at = ? WHERE id = ? AND status = 'active'", now, id)).changes === 1;
}

/** 采集器据此判断哪些项目已登记,未登记项目不推送 */
export function listActiveAgentProjects(db: Db, machineId: string): Promise<string[]>{
  const rows = await db.all("SELECT project FROM agent WHERE machine_id = ? AND status = 'active' ORDER BY project",, machineId) as Array<{ project: string }>;
  return rows.map((row) => row.project);
}

export interface MachineListQuery {
  limit: number;
  /** keyset 游标:上一页最后一行的 (createdAt, id) */
  before?: { createdAt: number; id: string };
}

export function listMachines(db: Db, query: MachineListQuery): Promise<MachineRecord[]>{
  const params: Record<string, unknown> = { limit: query.limit };
  let where = "";
  if (query.before !== undefined) {
    where =
      "WHERE created_at < @beforeCreatedAt OR (created_at = @beforeCreatedAt AND id < @beforeId)";
    params.beforeCreatedAt = query.before.createdAt;
    params.beforeId = query.before.id;
  }
  return await db.all(``SELECT ${MACHINE_COLUMNS} FROM machine ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,`, params.limit) as MachineRecord[];
}

export interface AgentRecord {
  id: string;
  machineId: string;
  project: string;
  displayName: string;
  secretHash: string;
  feishuAppId: string | null;
  feishuBotOpenId: string | null;
  feishuBotName: string | null;
  status: IdentityStatus;
  allowedTargetsJson: string;
  createdAt: number;
  updatedAt: number;
}

const AGENT_COLUMNS = `
  id, machine_id AS machineId, project, display_name AS displayName,
  secret_hash AS secretHash, feishu_app_id AS feishuAppId,
  feishu_bot_open_id AS feishuBotOpenId, feishu_bot_name AS feishuBotName, status,
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

export function insertAgent(db: Db, row: NewAgent): Promise<void>{
  await db.run(``INSERT INTO agent
       (id, machine_id, project, display_name, secret_hash, feishu_app_id, status,
        allowed_targets_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active',
        ?, ?, ?)`,`, row.id, row.machineId, row.project, row.displayName, row.secretHash, row.feishuAppId, row.allowedTargetsJson, row.createdAt, row.createdAt);
}

export function findAgentById(db: Db, id: string): Promise<AgentRecord | undefined>{
  return await db.get(`SELECT ${AGENT_COLUMNS} FROM agent WHERE id = ?`, id) as
    | AgentRecord
    | undefined;
}

export function findAgentByMachineProject(
  db: Db,
  machineId: string,
  project: string,
): Promise<AgentRecord | undefined>{
  return await db.get(`SELECT ${AGENT_COLUMNS} FROM agent WHERE machine_id = ? AND project = ?`, machineId, project) as AgentRecord | undefined;
}

export function updateAgentSecretHash(db: Db, id: string, hash: string, now: number): Promise<boolean>{
  return (await db.run("UPDATE agent SET secret_hash = ?, updated_at = ? WHERE id = ?", hash, now, id)).changes === 1;
}

/** bot 身份由该 Agent 自己的 proxy 启动时注册;重复注册同一值天然幂等。appId 为空时保留原值 */
export function updateAgentFeishuBot(
  db: Db,
  id: string,
  openId: string,
  name: string,
  appId: string | null,
  now: number,
): Promise<boolean>{
  return (await db.run(`UPDATE agent
         SET feishu_bot_open_id = ?, feishu_bot_name = ?,
             feishu_app_id = COALESCE(?, feishu_app_id), updated_at = ?
       WHERE id = ?`,, openId, name, appId, now, id)).changes === 1;
}

/** 委派白名单只由控制台会话写;保存即对下一次 a2a.send 判定生效 */
export function updateAgentAllowedTargets(
  db: Db,
  id: string,
  allowedTargetsJson: string,
  now: number,
): Promise<boolean>{
  return (await db.run("UPDATE agent SET allowed_targets_json = ?, updated_at = ? WHERE id = ?", allowedTargetsJson, now, id)).changes === 1;
}

export interface AgentListQuery {
  limit: number;
  before?: { createdAt: number; id: string };
}

export function listAgents(db: Db, query: AgentListQuery): Promise<AgentRecord[]>{
  const params: Record<string, unknown> = { limit: query.limit };
  let where = "";
  if (query.before !== undefined) {
    where =
      "WHERE created_at < @beforeCreatedAt OR (created_at = @beforeCreatedAt AND id < @beforeId)";
    params.beforeCreatedAt = query.before.createdAt;
    params.beforeId = query.before.id;
  }
  return await db.all(``SELECT ${AGENT_COLUMNS} FROM agent ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,`, params.limit) as AgentRecord[];
}
