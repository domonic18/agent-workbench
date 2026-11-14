/**
 * 5 字段 cron 解析(前后端共用一份)。
 *
 * 采集端用它推算下次执行时刻,前端用它把表达式说成人话——两边必须是同一套语义,
 * 否则「控制台显示每周六、实际周六不跑」这类错位无从察觉。
 *
 * 周字段按标准 cron:**0 与 7 都是周日**,6 是周六(与「1=周一」的直觉相反)。
 */

export interface CronField {
  /** true=通配(未受限) */
  any: boolean;
  values: Set<number>;
  /** 步长;`a-b/n` 与通配步长形态的 n,其余为 1 */
  step: number;
}

export interface CronSpec {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
}

/**
 * 解析单个 cron 字段:通配 / 单值 / 区间 / 列表 / 步长(形如 `a-b/n`)。
 *
 * 字段非法返回 null,不抛错——表达式是外部输入,解析不了就如实说解析不了。
 */
export function parseCronField(spec: string, min: number, max: number): CronField | null {
  const trimmed = spec.trim();
  if (trimmed === "") return null;
  if (trimmed === "*" || trimmed === "?") {
    const values = new Set<number>();
    for (let i = min; i <= max; i += 1) values.add(i);
    return { any: true, values, step: 1 };
  }
  const values = new Set<number>();
  let step = 1;
  for (const part of trimmed.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const partStep = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(partStep) || partStep <= 0) return null;
    step = Math.max(step, partStep);
    let start: number;
    let end: number;
    if (rangePart === undefined || rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [from, to] = rangePart.split("-");
      start = Number(from);
      end = Number(to);
    } else {
      start = Number(rangePart);
      end = stepPart === undefined ? start : max;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < min || end > max || start > end) return null;
    for (let i = start; i <= end; i += partStep) values.add(i);
  }
  if (values.size === 0) return null;
  return { any: false, values, step };
}

/** 解析 5 字段 cron 表达式 */
export function parseCron(expr: string): CronSpec | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const minute = parseCronField(fields[0] ?? "", 0, 59);
  const hour = parseCronField(fields[1] ?? "", 0, 23);
  const dom = parseCronField(fields[2] ?? "", 1, 31);
  const month = parseCronField(fields[3] ?? "", 1, 12);
  const dowRaw = parseCronField(fields[4] ?? "", 0, 7);
  if (minute === null || hour === null || dom === null || month === null || dowRaw === null) {
    return null;
  }
  const dowValues = new Set<number>();
  for (const value of dowRaw.values) dowValues.add(value === 7 ? 0 : value);
  return { minute, hour, dom, month, dow: { any: dowRaw.any, values: dowValues, step: dowRaw.step } };
}

/** dom 与 dow 同时受限时按「或」命中(Vixie cron 语义) */
export function cronMatchesDay(spec: CronSpec, day: Date): boolean {
  if (!spec.dom.any && !spec.dow.any) {
    return spec.dom.values.has(day.getDate()) || spec.dow.values.has(day.getDay());
  }
  if (spec.dom.any) return spec.dow.values.has(day.getDay());
  return spec.dom.values.has(day.getDate());
}

/**
 * 求下一次执行时刻(epoch ms),按**所在机器的本地时区**。
 *
 * 计划在发起它的机器上按本地时间触发,控制台服务器可能在别的时区,
 * 所以推算放在采集端,只把结果与 IANA 时区名上报。
 */
export function nextCronRun(spec: CronSpec, from: number): number | null {
  const start = new Date(from);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  const hours = [...spec.hour.values].sort((a, b) => a - b);
  const minutes = [...spec.minute.values].sort((a, b) => a - b);
  for (let offset = 0; offset <= 366; offset += 1) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    if (!spec.month.values.has(day.getMonth() + 1)) continue;
    if (!cronMatchesDay(spec, day)) continue;
    for (const hour of hours) {
      if (offset === 0 && hour < start.getHours()) continue;
      for (const minute of minutes) {
        if (offset === 0 && hour === start.getHours() && minute < start.getMinutes()) continue;
        return new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          hour,
          minute,
          0,
          0,
        ).getTime();
      }
    }
  }
  return null;
}
