/**
 * 定时任务只读观测。
 *
 * 真相源在 cc-connect 侧:执行机上报本机计划的快照,控制台只负责把快照与名册里的
 * Agent 机器人对上号,不提供改频率、停用、手动触发等动作。
 */
import { MACHINE_HEARTBEAT } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { findAgentByMachineProject } from "../../store/repositories/agent.js";
import { listMachines } from "../../store/repositories/machine.js";
import type { ScheduleRow } from "./types.js";

export type { ScheduleRow } from "./types.js";

/** 机器列表页大小:机器数量有限,一次取全 */
const MACHINE_LIMIT = 200;

/** 机器离线判定沿用心跳口径(04 §6) */
function isStale(machine: { status: string; lastSeenAt: number | null }, now: number): boolean {
  if (machine.status !== "active") return true;
  if (machine.lastSeenAt === null) return true;
  return now - machine.lastSeenAt > MACHINE_HEARTBEAT.offlineMs;
}

/**
 * 列出全部机器上的定时任务。
 *
 * Agent 归属按 **(机器, 项目)** 关联:名册里同一 project 可能有多台机器各注册一个
 * Agent(如 workbuddy),按 project 单键会把机器人搞混。
 */
export async function listScheduleRows(db: Db, now: number): Promise<ScheduleRow[]> {
  const machines = await listMachines(db, { limit: MACHINE_LIMIT });
  const rows: ScheduleRow[] = [];
  for (const machine of machines) {
    const stale = isStale(machine, now);
    for (const schedule of machine.schedules ?? []) {
      const agent =
        schedule.project === ""
          ? undefined
          : await findAgentByMachineProject(db, machine.id, schedule.project);
      rows.push({
        id: schedule.id,
        project: schedule.project,
        kind: schedule.kind,
        description: schedule.description,
        cronExpr: schedule.cron_expr,
        scheduledAt: schedule.scheduled_at,
        nextRunAt: schedule.next_run,
        lastRunAt: schedule.last_run,
        lastError: schedule.last_error,
        enabled: schedule.enabled,
        timezone: schedule.timezone,
        machineId: machine.id,
        machineName: machine.displayName ?? machine.hostname,
        agentId: agent?.id ?? null,
        agentName: agent?.displayName ?? null,
        botName: agent?.feishuBotName ?? null,
        stale,
        collectedAt: machine.discoveryReceivedAt,
      });
    }
  }
  return rows;
}
