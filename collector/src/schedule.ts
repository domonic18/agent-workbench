/**
 * 本机 cc-connect 定时任务快照采集。
 *
 * cc-connect 把周期任务放在 `<dir>/crons/jobs.json`、一次性延时任务放在
 * `<dir>/timers/jobs.json`。控制台要展示「执行时间 / 执行频率 / 对应机器人」,
 * 只需要这两个文件里的元数据。
 *
 * **敏感内容在采集端剔除**:prompt 实测含明文 ssh 命令与内网地址、exec 是本机脚本路径、
 * session_key 是飞书会话与 open_id——一律不取、不上报、不落库。控制台公网可达,
 * 这些内容不能出机器。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScheduleReport } from "../../src/shared/aw-node-wire.js";
import { nextCronRun, parseCron } from "../../src/shared/cron.js";

/** 标题长度上限:控制台只展示一行标题,超长截断 */
const DESCRIPTION_MAX = 120;
/** 错误摘要长度上限 */
const ERROR_MAX = 200;

/**
 * cron 表达式 → 下次执行时刻(epoch ms,按本机本地时区)。
 *
 * 解析语义与前端展示共用 `src/shared/cron.ts` 一份,避免两边对「周六是哪天」理解不一致。
 */
export function nextRunAt(expr: string, from: number): number | null {
  const spec = parseCron(expr);
  return spec === null ? null : nextCronRun(spec, from);
}

/** 读取 cc-connect 的 jobs 文件;文件缺失或损坏返回空数组,不阻断发现上报 */
function readJobs(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    );
  } catch {
    return [];
  }
}

/**
 * epoch 值归一化
 *
 * cc-connect 各版本写法不一:有的记 ISO 字符串,有的记 epoch 秒(带小数)。
 * 小于 1e11 的数值按秒解释(1e11 ms ≈ 1973 年),否则按毫秒;
 * 一律向下取整成整数毫秒——服务端协议要求整数字段,带小数会被整包拒收。
 *
 * 负数是「从未执行」的占位值(实测 -62135596800000),一律当没有。
 */
const EPOCH_SECONDS_CUTOFF = 1e11;

function normalizeEpoch(value: number): number | null {
  const ms = Math.abs(value) < EPOCH_SECONDS_CUTOFF ? value * 1000 : value;
  const floored = Math.floor(ms);
  return floored < 0 ? null : floored;
}

/** ISO 字符串 / epoch 数字 → 整数毫秒;不可解析返回 null */
function toEpoch(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeEpoch(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return normalizeEpoch(numeric);
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function textOf(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * 错误摘要脱敏:cc-connect 的 last_error 常内嵌飞书会话键(chat_id/open_id),
 * 控制台公网可达,这类标识不出机器。
 */
function redactError(value: unknown): string | null {
  const text = textOf(value, ERROR_MAX);
  if (text === null) return null;
  return text.replace(/feishu:[A-Za-z0-9_.:-]+/g, "会话");
}

/** 采集本机 cc-connect 的定时任务快照 */
export function collectSchedules(input: {
  ccConnectDir: string;
  now: number;
  timezone: string;
}): ScheduleReport[] {
  const crons = readJobs(join(input.ccConnectDir, "crons", "jobs.json"));
  const timers = readJobs(join(input.ccConnectDir, "timers", "jobs.json"));
  const rows: ScheduleReport[] = [];

  for (const [index, job] of crons.entries()) {
    const expr = textOf(job.cron_expr, 120);
    const project = textOf(job.project, 200) ?? "";
    // 兜底 id 带下标:同项目同表达式的两条计划不能撞 id(前端按 id 当行键)
    const id = textOf(job.id, 64) ?? `${project}:${expr ?? "cron"}:${index}`;
    const enabled = job.enabled !== false;
    rows.push({
      id: `cron:${id}`,
      project,
      kind: "cron",
      description: textOf(job.description, DESCRIPTION_MAX) ?? project,
      cron_expr: expr,
      scheduled_at: null,
      enabled,
      last_run: toEpoch(job.last_run),
      next_run: enabled && expr !== null ? nextRunAt(expr, input.now) : null,
      last_error: redactError(job.last_error),
      created_at: toEpoch(job.created_at),
      timezone: input.timezone,
    });
  }

  for (const [index, job] of timers.entries()) {
    // 已触发的延时任务是历史流水,不进控制台清单
    if (job.fired === true) continue;
    const project = textOf(job.project, 200) ?? "";
    const id = textOf(job.id, 64) ?? `${project}:timer:${index}`;
    const scheduledAt = toEpoch(job.scheduled_at);
    rows.push({
      id: `timer:${id}`,
      project,
      kind: "timer",
      description: textOf(job.description, DESCRIPTION_MAX) ?? project,
      cron_expr: null,
      scheduled_at: scheduledAt,
      enabled: true,
      last_run: null,
      next_run: scheduledAt,
      last_error: null,
      created_at: toEpoch(job.created_at),
      timezone: input.timezone,
    });
  }

  return rows;
}
