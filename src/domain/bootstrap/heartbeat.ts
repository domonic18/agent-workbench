import { AUTH_STALE_HEAL_COOLDOWN_MS } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { clearAgentConfigAcksForHeal } from "../../store/repositories/agent.js";
import {
  listActiveAgentProjects,
  touchMachineLastSeen,
  updateMachineActiveStreams,
  updateMachineCollectorVersion,
  updateMachineDispatchStatus,
  type MachineDispatchStatusEntry,
  type MachineRecord,
} from "../../store/repositories/machine.js";
import { announceDispatchHold } from "../work/notify.js";

export interface MachineHeartbeatInput {
  /** 自上一跳以来有新字节的流(L2 观测续命,04 §2);未携带即整包覆盖为空 */
  activeStreams?: string[];
  /** 采集器自身版本;未携带保留 enroll 时落的值 */
  collectorVersion?: string;
  /** 派发状态快照(M3.12);空快照省略字段,旧采集器兼容 */
  dispatch?: MachineDispatchStatusEntry[];
}

export interface RecordHeartbeatOptions {
  machine: MachineRecord;
  heartbeat: MachineHeartbeatInput;
  collabChatId?: string | undefined;
  now: () => number;
}

export interface RecordHeartbeatResult {
  /** auth_stale 自愈清掉的配置回执数(下轮拉取自动轮换重发) */
  healedAcks: number;
  /** 自愈命中的项目 */
  healedProjects: string[];
}

/**
 * 机器心跳(04 §2):推进存活时间、整包覆盖活跃流、可选更新采集器版本与派发状态;
 * auth_stale 触发自愈(清配置回执,10min 冷却防轮换风暴),新挂起首跳播报。
 * CPU / 内存等指标不入库。
 */
export async function recordMachineHeartbeat(
  db: Db,
  options: RecordHeartbeatOptions,
): Promise<RecordHeartbeatResult> {
  const { machine, heartbeat, collabChatId, now } = options;
  await touchMachineLastSeen(db, machine.id, now());
  await updateMachineActiveStreams(db, machine.id, heartbeat.activeStreams ?? []);
  if (heartbeat.collectorVersion !== undefined) {
    await updateMachineCollectorVersion(db, machine.id, heartbeat.collectorVersion);
  }
  if (heartbeat.dispatch === undefined) {
    return { healedAcks: 0, healedProjects: [] };
  }
  await updateMachineDispatchStatus(db, machine.id, heartbeat.dispatch);
  const staleProjects = heartbeat.dispatch
    .filter((entry) => entry.hold === "auth_stale")
    .map((entry) => entry.project);
  let healedAcks = 0;
  if (staleProjects.length > 0) {
    healedAcks = await clearAgentConfigAcksForHeal(db, {
      machineId: machine.id,
      projects: staleProjects,
      ackedBefore: now() - AUTH_STALE_HEAL_COOLDOWN_MS,
      now: now(),
    });
  }
  // 首跳播报(M3.12):与更新前的快照按 (project, hold) 比对,
  // 持续挂起不重播;挂起消除后重现(since_ts 变化)由幂等键兜住再播
  const previousHolds = new Set(
    machine.dispatchStatus.map((entry) => `${entry.project}@${entry.hold}`),
  );
  for (const entry of heartbeat.dispatch) {
    if (previousHolds.has(`${entry.project}@${entry.hold}`)) {
      continue;
    }
    await announceDispatchHold(db, {
      machineId: machine.id,
      hostname: machine.hostname,
      project: entry.project,
      hold: entry.hold,
      pending: entry.pending,
      sinceTs: entry.since_ts,
      chatId: collabChatId,
      now: now(),
    });
  }
  return { healedAcks, healedProjects: healedAcks > 0 ? staleProjects : [] };
}

/** 单点心跳推进(run-end 宣告等机器面入口):上报即存活 */
export async function touchHeartbeat(db: Db, machineId: string, at: number): Promise<void> {
  await touchMachineLastSeen(db, machineId, at);
}

/** 拉取通道可用项目清单(04 §4):机器 Bearer 拉取自己可推送的项目 */
export async function listPushableProjects(db: Db, machineId: string): Promise<string[]> {
  return listActiveAgentProjects(db, machineId);
}
