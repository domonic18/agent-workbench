/**
 * cron 表达式的人话描述(纯前端展示映射)。
 *
 * 解析语义与采集端共用 `@shared/cron` 一份——「周六」是哪天不能两边各理解一次。
 */
import { parseCron } from "@shared/cron.js";

const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

export interface CronDescription {
  /** 描述文案;解析不了时原样给出表达式 */
  text: string;
  /** false=表达式解析不了,界面需如实标注 */
  parsed: boolean;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/** 把 5 字段 cron 说成人话;解析不了就如实说解析不了 */
export function describeCron(expr: string): CronDescription {
  const spec = parseCron(expr);
  if (spec === null) {
    return { text: expr, parsed: false };
  }

  const minutes = [...spec.minute.values].sort((a, b) => a - b);
  const hours = [...spec.hour.values].sort((a, b) => a - b);

  if (spec.minute.any) {
    return { text: "每分钟", parsed: true };
  }
  if (spec.minute.step > 1) {
    return { text: `每 ${spec.minute.step} 分钟`, parsed: true };
  }
  if (spec.hour.any) {
    const marks = minutes.map((minute) => pad(minute)).join("、");
    return { text: `每小时 ${marks} 分`, parsed: true };
  }

  const times: string[] = [];
  for (const hour of hours) {
    for (const minute of minutes) {
      times.push(`${pad(hour)}:${pad(minute)}`);
    }
  }
  const timeText = times.join(" / ");

  if (!spec.month.any) {
    const months = [...spec.month.values].sort((a, b) => a - b).map((m) => `${m} 月`);
    const doms = [...spec.dom.values].sort((a, b) => a - b);
    const dayText = spec.dom.any ? "" : ` ${doms.join("、")} 日`;
    return { text: `每年 ${months.join("、")}${dayText} ${timeText}`, parsed: true };
  }
  if (!spec.dow.any) {
    const days = [...spec.dow.values].sort((a, b) => a - b);
    const isWorkweek =
      days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day));
    if (isWorkweek) {
      return { text: `工作日 ${timeText}`, parsed: true };
    }
    const names = days.map((day) => WEEKDAY_CN[day] ?? `周${day}`);
    return { text: `每${names.join("、")} ${timeText}`, parsed: true };
  }
  if (!spec.dom.any) {
    const doms = [...spec.dom.values].sort((a, b) => a - b);
    return { text: `每月 ${doms.join("、")} 日 ${timeText}`, parsed: true };
  }
  return { text: `每天 ${timeText}`, parsed: true };
}
