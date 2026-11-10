import type { IdentityStatus } from "../../shared/constants.js";
import type { Db } from "../database.js";

export interface MachineRecord {
  id: string;
  hostname: string;
  /** 展示名:可与 hostname 不同(主机名登记成 IP 时可改);为空表示未回填 */
  displayName: string | null;
  os: string;
  collectorVersion: string;
  collectorSecretHash: string;
  lastSeenAt: number | null;
  status: IdentityStatus;
  createdAt: number;
  discoveryJson: string | null;
  discoveryReceivedAt: number | null;
  configStatus: MachineConfigStatus;
  botRefreshRequestedAt: number | null;
  /** 心跳上报的活跃流(L2 观测续命):自上一跳以来有新字节的 stream_id 列表 */
  activeStreams: string[];
}

export type MachineConfigStatus = "pending" | "delivered" | "effective";

const MACHINE_COLUMNS = `
  id, hostname, display_name AS "displayName", os, collector_version AS "collectorVersion",
  collector_secret_hash AS "collectorSecretHash", last_seen_at AS "lastSeenAt",
  status, created_at AS "createdAt",
  discovery_json AS "discoveryJson", discovery_received_at AS "discoveryReceivedAt",
  config_status AS "configStatus", bot_refresh_requested_at AS "botRefreshRequestedAt",
  active_streams AS "activeStreams"
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
       (id, hostname, display_name, os, collector_version, collector_secret_hash, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    row.id, row.hostname, row.hostname, row.os, row.collectorVersion, row.collectorSecretHash,
    row.createdAt,
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

/** 改展示名:只动 display_name,hostname 去重键与 Agent 绑定不受影响 */
export async function updateMachineDisplayName(
  db: Db,
  id: string,
  displayName: string,
): Promise<boolean> {
  return (
    (
      await db.run("UPDATE machine SET display_name = ? WHERE id = ?", displayName, id)
    ).changes === 1
  );
}

/**
 * 复用存量机器行时刷新采集器版本;机器 id 与 Agent 绑定不变。
 * 值未变化时不写(心跳每分钟都带版本,免无谓 churn)。
 */
export async function updateMachineCollectorVersion(
  db: Db,
  id: string,
  collectorVersion: string,
): Promise<boolean> {
  return (
    (await db.run(
      "UPDATE machine SET collector_version = ? WHERE id = ? AND collector_version <> ?",
      collectorVersion, id, collectorVersion,
    )).changes === 1
  );
}

/**
 * 复用候选:同主机名同系统、状态可用、且已无存活上报(从未上报或心跳超时)的机器。
 * 执行机重装或密钥丢失后重新 enroll 时复用同一行,避免同一台机在库里堆出多行,
 * 也保住该行上已有的 Agent 绑定。
 */
export async function findReusableMachine(
  db: Db,
  query: { hostname: string; os: string; staleBefore: number },
): Promise<MachineRecord | undefined> {
  const rows = (await db.all(
    `SELECT ${MACHINE_COLUMNS} FROM machine
      WHERE hostname = ? AND os = ? AND status = 'active'
        AND (last_seen_at IS NULL OR last_seen_at < ?)
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    query.hostname, query.os, query.staleBefore,
  )) as MachineRecord[];
  return rows[0];
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

/**
 * 心跳活跃流整包覆盖(04 §2 L2):absent 一律写空数组——
 * 机器降级回不带上报的旧版本时,旧活跃集不得永久豁免 L3 收敛。
 */
export async function updateMachineActiveStreams(
  db: Db,
  id: string,
  streams: string[],
): Promise<boolean> {
  return (
    (
      await db.run("UPDATE machine SET active_streams = ?::jsonb WHERE id = ? AND status = 'active'",
        JSON.stringify(streams), id)
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

/** 控制台发起「刷新 bot 名」:记录请求时刻,待 /api/aw-node/config 拉取时下发并消费 */
export async function requestMachineBotRefresh(db: Db, id: string, now: number): Promise<boolean> {
  return (
    (
      await db.run("UPDATE machine SET bot_refresh_requested_at = ? WHERE id = ?", now, id)
    ).changes === 1
  );
}

/** 下发刷新信号后清空标记;返回是否有过待消费的刷新请求 */
export async function consumeMachineBotRefresh(db: Db, id: string): Promise<boolean> {
  const row = (await db.get(
    "SELECT bot_refresh_requested_at AS at FROM machine WHERE id = ?",
    id,
  )) as { at: number | null } | undefined;
  if (row === undefined || row.at === null) {
    return false;
  }
  await db.run("UPDATE machine SET bot_refresh_requested_at = NULL WHERE id = ?", id);
  return true;
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
