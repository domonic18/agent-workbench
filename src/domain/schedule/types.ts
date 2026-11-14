/**
 * 定时任务只读观测的对外形状。
 *
 * 与前端 `web/src/api/types.ts` 里的手写副本一一对应(项目惯例:两侧各维护一份,
 * 改字段必须同改)。
 */
export interface ScheduleRow {
  /** 计划唯一标识:机器内唯一,形如 `cron:<job id>` */
  id: string;
  /** cc-connect 项目名 */
  project: string;
  /** cron=周期任务;timer=一次性延时任务 */
  kind: "cron" | "timer";
  /** 任务标题(人工可读) */
  description: string;
  /** 周期任务的 cron 表达式;一次性任务为 null */
  cronExpr: string | null;
  /** 一次性任务的执行时刻(epoch ms) */
  scheduledAt: number | null;
  /** 下次执行时刻(epoch ms) */
  nextRunAt: number | null;
  /** 上次执行时刻(epoch ms) */
  lastRunAt: number | null;
  /** 上次执行的错误摘要(已脱敏) */
  lastError: string | null;
  enabled: boolean;
  /** 计划所在机器的 IANA 时区 */
  timezone: string;
  machineId: string;
  machineName: string;
  /** 关联到的 Agent;项目未登记时为 null */
  agentId: string | null;
  /** Agent 展示名 */
  agentName: string | null;
  /** 飞书 bot 名(优先展示) */
  botName: string | null;
  /** 机器离线或久未上报:计划状态未知 */
  stale: boolean;
  /** 最后采集时刻(epoch ms) */
  collectedAt: number | null;
}
