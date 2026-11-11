import type { AgentRuntime, IdentityStatus } from "../../shared/constants.js";
import type { Db } from "../database.js";


export type AgentBootstrapStatus = "confirmed" | "registered";

export interface AgentRecord {
  id: string;
  machineId: string | null;
  runtime: AgentRuntime;
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
  id, machine_id AS "machineId", runtime, project, display_name AS "displayName",
  secret_hash AS "secretHash", feishu_app_id AS "feishuAppId",
  feishu_bot_open_id AS "feishuBotOpenId", feishu_bot_name AS "feishuBotName", status,
  allowed_targets_json AS "allowedTargetsJson", bootstrap_status AS "bootstrapStatus",
  key, mcp_config_json AS "mcpConfigJson",
  config_version AS "configVersion", config_ack_at AS "configAckAt",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

export interface NewAgent {
  id: string;
  machineId: string | null;
  runtime: AgentRuntime;
  project: string;
  displayName: string;
  secretHash: string | null;
  /** 缺省视为人工注册:无稳定 key、无待下发配置 */
  key?: string | null;
  mcpConfigJson?: string | null;
  bootstrapStatus?: AgentBootstrapStatus;
  feishuAppId: string | null;
  feishuBotOpenId?: string | null;
  feishuBotName?: string | null;
  allowedTargetsJson: string;
  createdAt: number;
}

export async function insertAgent(db: Db, row: NewAgent): Promise<void> {
  await db.run(
    `INSERT INTO agent
       (id, machine_id, runtime, project, display_name, secret_hash, feishu_app_id,
        feishu_bot_open_id, feishu_bot_name, status,
        allowed_targets_json, key, mcp_config_json, bootstrap_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    row.id, row.machineId, row.runtime, row.project, row.displayName, row.secretHash,
    row.feishuAppId, row.feishuBotOpenId ?? null, row.feishuBotName ?? null,
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

/**
 * 轮换 Agent 密钥即清配置回执(M3.11):ACK 过的 Agent 不会被周期下发照顾,
 * 新密钥必须能到达机器,否则两侧密钥劈开只能人肉修。
 * 调用方:rotateAgentSecret(管理员轮换与自助兑换共用)。
 */
export async function updateAgentSecretHash(db: Db, id: string, hash: string, now: number): Promise<boolean> {
  return (
    (
      await db.run(
        "UPDATE agent SET secret_hash = ?, config_ack_at = NULL, updated_at = ? WHERE id = ?",
        hash, now, id,
      )
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

/**
 * auth_stale 自愈(M3.11):机器探视连续 401 时清回执,下轮拉取自动轮换重发。
 * 只动 ACK 距今超过冷却期(默认 10min)的行,防轮换风暴;返回清掉的行数。
 */
export async function clearAgentConfigAcksForHeal(
  db: Db,
  query: { machineId: string; projects: string[]; ackedBefore: number; now: number },
): Promise<number> {
  if (query.projects.length === 0) {
    return 0;
  }
  const placeholders = query.projects.map(() => "?").join(", ");
  return (
    (
      await db.run(
        `UPDATE agent
           SET config_ack_at = NULL, updated_at = ?
         WHERE machine_id = ? AND project IN (${placeholders})
           AND config_ack_at IS NOT NULL AND config_ack_at < ?`,
        query.now, query.machineId, ...query.projects, query.ackedBefore,
      )
    ).changes
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

/**
 * 发现上报回写 bot 名:aw-node 用本机凭据现取到的展示名随发现结果进来,
 * 按 (machine_id, project) 落到该机已登记 Agent。手动刷新与 7 天缓存到期都走这里。
 */
export async function updateAgentFeishuBotByProject(
  db: Db,
  machineId: string,
  project: string,
  openId: string,
  name: string,
  now: number,
): Promise<boolean> {
  return (
    (
      await db.run(
        `UPDATE agent
           SET feishu_bot_name = ?, feishu_bot_open_id = ?, updated_at = ?
         WHERE machine_id = ? AND project = ? AND status = 'active'`,
        name, openId, now, machineId, project,
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

/** 按 id 批量取 Agent:委派白名单的可达目标用它渲染,不按创建顺序排 */
export async function listAgentsByIds(db: Db, ids: readonly string[]): Promise<AgentRecord[]> {
  if (ids.length === 0) {
    return [];
  }
  const placeholders = ids.map(() => "?").join(", ");
  return (await db.all(
    `SELECT ${AGENT_COLUMNS} FROM agent WHERE id IN (${placeholders})`,
    ...ids,
  )) as AgentRecord[];
}
