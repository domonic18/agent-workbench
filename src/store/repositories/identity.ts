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
  discoveryJson: string | null;
  discoveryReceivedAt: number | null;
  configStatus: MachineConfigStatus;
}

export type MachineConfigStatus = "pending" | "delivered" | "effective";

const MACHINE_COLUMNS = `
  id, hostname, os, collector_version AS "collectorVersion",
  collector_secret_hash AS "collectorSecretHash", last_seen_at AS "lastSeenAt",
  status, created_at AS "createdAt",
  discovery_json AS "discoveryJson", discovery_received_at AS "discoveryReceivedAt",
  config_status AS "configStatus"
`;

export interface NewMachine {
  id: string;
  hostname: string;
  os: string;
  collectorVersion: string;
  collectorSecretHash: string;
  createdAt: number;
}

export async function insertMachine(db: Db, row: NewMachine): Promise<void> {
  await db.run(
    `INSERT INTO machine
       (id, hostname, os, collector_version, collector_secret_hash, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    row.id, row.hostname, row.os, row.collectorVersion, row.collectorSecretHash, row.createdAt,
  );
}

export async function findMachineById(db: Db, id: string): Promise<MachineRecord | undefined> {
  return (await db.get(`SELECT ${MACHINE_COLUMNS} FROM machine WHERE id = ?`, id)) as
    | MachineRecord
    | undefined;
}

export async function updateMachineSecretHash(db: Db, id: string, hash: string): Promise<boolean> {
  return (
    (await db.run("UPDATE machine SET collector_secret_hash = ? WHERE id = ?", hash, id)).changes === 1
  );
}

/** 采集器心跳只推进机器存活时间;机器活着不等于 Agent 在跑 */
export async function touchMachineLastSeen(db: Db, id: string, now: number): Promise<boolean> {
  return (
    (
      await db.run(
        "UPDATE machine SET last_seen_at = ? WHERE id = ? AND status = 'active'",
        now, id,
      )
    ).changes === 1
  );
}

/** 采集器据此判断哪些项目已登记,未登记项目不推送 */
export async function listActiveAgentProjects(db: Db, machineId: string): Promise<string[]> {
  const rows = (await db.all(
    "SELECT project FROM agent WHERE machine_id = ? AND status = 'active' ORDER BY project",
    machineId,
  )) as Array<{ project: string }>;
  return rows.map((row) => row.project);
}

/** aw-node 上报的 cc-connect 发现结果整包覆盖保存;读取侧由 GET /api/bootstrap/discovery 预填 */
export async function saveMachineDiscovery(
  db: Db,
  id: string,
  discoveryJson: string,
  receivedAt: number,
): Promise<boolean> {
  return (
    (
      await db.run(
        "UPDATE machine SET discovery_json = ?, discovery_received_at = ? WHERE id = ?",
        discoveryJson, receivedAt, id,
      )
    ).changes === 1
  );
}

/** 配置下发状态机:pending(确认待下发)→ delivered(已拉取待 ACK)→ effective(ACK 已回执) */
export async function updateMachineConfigStatus(
  db: Db,
  id: string,
  status: MachineConfigStatus,
): Promise<boolean> {
  return (
    (await db.run("UPDATE machine SET config_status = ? WHERE id = ?", status, id)).changes === 1
  );
}

export interface MachineListQuery {
  limit: number;
  /** keyset 游标:上一页最后一行的 (createdAt, id) */
  before?: { createdAt: number; id: string };
}

export async function listMachines(db: Db, query: MachineListQuery): Promise<MachineRecord[]> {
  const params: unknown[] = [query.limit];
  let where = "";
  if (query.before !== undefined) {
    where = "WHERE created_at < $2 OR (created_at = $2 AND id < $3)";
    params.push(query.before.createdAt, query.before.id);
  }
  return (await db.all(
    `SELECT ${MACHINE_COLUMNS} FROM machine ${where} ORDER BY created_at DESC, id DESC LIMIT $1`,
    ...params,
  )) as MachineRecord[];
}

export type AgentBootstrapStatus = "confirmed" | "registered";

export interface AgentRecord {
  id: string;
  machineId: string;
  project: string;
  displayName: string;
  /** 项目确认阶段只建身份,为 null 表示尚未经 /api/aw-node/config 签发 */
  secretHash: string | null;
  feishuAppId: string | null;
  feishuBotOpenId: string | null;
  feishuBotName: string | null;
  status: IdentityStatus;
  allowedTargetsJson: string;
  /** confirmed=bootstrap 确认(密钥走配置下发);registered=人工注册(密钥即响应明文) */
  bootstrapStatus: AgentBootstrapStatus;
  key: string | null;
  mcpConfigJson: string | null;
  configVersion: number;
  configAckAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const AGENT_COLUMNS = `
  id, machine_id AS "machineId", project, display_name AS "displayName",
  secret_hash AS "secretHash", feishu_app_id AS "feishuAppId",
  feishu_bot_open_id AS "feishuBotOpenId", feishu_bot_name AS "feishuBotName", status,
  allowed_targets_json AS "allowedTargetsJson", bootstrap_status AS "bootstrapStatus",
  key, mcp_config_json AS "mcpConfigJson",
  config_version AS "configVersion", config_ack_at AS "configAckAt",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

export interface NewAgent {
  id: string;
  machineId: string;
  project: string;
  displayName: string;
  secretHash: string | null;
  /** 缺省视为人工注册:无稳定 key、无待下发配置 */
  key?: string | null;
  mcpConfigJson?: string | null;
  bootstrapStatus?: AgentBootstrapStatus;
  feishuAppId: string | null;
  allowedTargetsJson: string;
  createdAt: number;
}

export async function insertAgent(db: Db, row: NewAgent): Promise<void> {
  await db.run(
    `INSERT INTO agent
       (id, machine_id, project, display_name, secret_hash, feishu_app_id, status,
        allowed_targets_json, key, mcp_config_json, bootstrap_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    row.id, row.machineId, row.project, row.displayName, row.secretHash, row.feishuAppId,
    row.allowedTargetsJson, row.key ?? null, row.mcpConfigJson ?? null,
    row.bootstrapStatus ?? "registered", row.createdAt, row.createdAt,
  );
}

export async function findAgentById(db: Db, id: string): Promise<AgentRecord | undefined> {
  return (await db.get(`SELECT ${AGENT_COLUMNS} FROM agent WHERE id = ?`, id)) as
    | AgentRecord
    | undefined;
}

export async function findAgentByMachineProject(
  db: Db,
  machineId: string,
  project: string,
): Promise<AgentRecord | undefined> {
  return (await db.get(
    `SELECT ${AGENT_COLUMNS} FROM agent WHERE machine_id = ? AND project = ?`,
    machineId, project,
  )) as AgentRecord | undefined;
}

export async function updateAgentSecretHash(db: Db, id: string, hash: string, now: number): Promise<boolean> {
  return (
    (
      await db.run("UPDATE agent SET secret_hash = ?, updated_at = ? WHERE id = ?", hash, now, id)
    ).changes === 1
  );
}

export async function findAgentByKey(db: Db, key: string): Promise<AgentRecord | undefined> {
  return (await db.get(`SELECT ${AGENT_COLUMNS} FROM agent WHERE key = ?`, key)) as
    | AgentRecord
    | undefined;
}

export async function listAgentsByMachine(db: Db, machineId: string): Promise<AgentRecord[]> {
  return (await db.all(
    `SELECT ${AGENT_COLUMNS} FROM agent WHERE machine_id = ? ORDER BY project`,
    machineId,
  )) as AgentRecord[];
}

/** ACK 前的配置拉取轮换:覆盖哈希、推进版本并清空回执——旧明文立即失效 */
export async function rotateAgentDeliverySecret(
  db: Db,
  id: string,
  hash: string,
  configVersion: number,
  now: number,
): Promise<boolean> {
  return (
    (
      await db.run(
        `UPDATE agent
           SET secret_hash = ?, config_version = ?, config_ack_at = NULL, updated_at = ?
         WHERE id = ?`,
        hash, configVersion, now, id,
      )
    ).changes === 1
  );
}

/** ACK 只对已下发且版本一致的行为生效;版本不符返回 false 由上层按过期配置处理 */
export async function markAgentConfigAck(
  db: Db,
  id: string,
  configVersion: number,
  now: number,
): Promise<boolean> {
  return (
    (
      await db.run(
        `UPDATE agent
           SET config_ack_at = ?, updated_at = ?
         WHERE id = ? AND config_version = ? AND secret_hash IS NOT NULL`,
        now, now, id, configVersion,
      )
    ).changes === 1
  );
}

/** bot 身份由该 Agent 自己的 proxy 启动时注册;重复注册同一值天然幂等。appId 为空时保留原值 */
export async function updateAgentFeishuBot(
  db: Db,
  id: string,
  openId: string,
  name: string,
  appId: string | null,
  now: number,
): Promise<boolean> {
  return (
    (
      await db.run(
        `UPDATE agent
           SET feishu_bot_open_id = ?, feishu_bot_name = ?,
               feishu_app_id = COALESCE(?, feishu_app_id), updated_at = ?
         WHERE id = ?`,
        openId, name, appId, now, id,
      )
    ).changes === 1
  );
}

/** 委派白名单只由控制台会话写;保存即对下一次 a2a.send 判定生效 */
export async function updateAgentAllowedTargets(
  db: Db,
  id: string,
  allowedTargetsJson: string,
  now: number,
): Promise<boolean> {
  return (
    (
      await db.run(
        "UPDATE agent SET allowed_targets_json = ?, updated_at = ? WHERE id = ?",
        allowedTargetsJson, now, id,
      )
    ).changes === 1
  );
}

export interface AgentListQuery {
  limit: number;
  before?: { createdAt: number; id: string };
}

export async function listAgents(db: Db, query: AgentListQuery): Promise<AgentRecord[]> {
  const params: unknown[] = [query.limit];
  let where = "";
  if (query.before !== undefined) {
    where = "WHERE created_at < $2 OR (created_at = $2 AND id < $3)";
    params.push(query.before.createdAt, query.before.id);
  }
  return (await db.all(
    `SELECT ${AGENT_COLUMNS} FROM agent ${where} ORDER BY created_at DESC, id DESC LIMIT $1`,
    ...params,
  )) as AgentRecord[];
}
