/** 精确值只在这里格式化,供 title 展示(03 §6) */
export function formatExactTokens(value: number): string {
  return value.toLocaleString("en-US");
}

/** 千分位;百万以上缩写,精确值放 title */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    const millions = (value / 1_000_000).toFixed(1).replace(/\.0$/, "");
    return `${millions}M`;
  }
  return formatExactTokens(value);
}

/** 字节体积口径：KB 起步，否则 MB 保留一位小数 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatDateTime(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 按指定 IANA 时区格式化时刻
 *
 * 定时任务在发起它的机器上按本地时间触发,浏览器可能在别的时区——
 * 「下次执行 19:00」必须按计划自己的时区渲染,否则读出来是错的。
 */
export function formatDateTimeIn(at: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      hourCycle: "h23",
    }).formatToParts(new Date(at));
    const pick = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}:${pick("second")}`;
  } catch {
    // 时区名非法(旧机器上报了怪值):退回浏览器本地时区,不要整列报错
    return formatDateTime(at);
  }
}

/** 耗时统一口径;负值按 0 处理,避免时钟回拨显示负数 */
export function formatDuration(ms: number): string {
  const value = Math.max(0, ms);
  if (value < 60_000) {
    return `${Math.floor(value / 1_000)} 秒`;
  }
  const minutes = Math.floor(value / 60_000);
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return minutes % 60 === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes % 60} 分`;
  }
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days} 天` : `${days} 天 ${hours % 24} 小时`;
}

/** 表格窄列用的紧凑口径;完整口径放 title */
export function formatCompactDuration(ms: number): string {
  const value = Math.max(0, ms);
  if (value < 60_000) {
    return `${Math.floor(value / 1_000)}s`;
  }
  const minutes = Math.floor(value / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return minutes % 60 === 0 ? `${hours}h` : `${hours}h${minutes % 60}m`;
  }
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days}d` : `${days}d${hours % 24}h`;
}

/**
 * 未来时刻的倒计时口径(如「7 小时后」)
 *
 * `formatRelativeTime` 只说过去,对下一次执行时刻会算出负差值显示「刚刚」——
 * 那是误导,单独给一个倒计时口径。
 */
export function formatCountdown(at: number, now: number = Date.now()): string {
  const diff = at - now;
  if (diff <= 0) {
    return "已到点";
  }
  if (diff < 60_000) {
    return "不到 1 分钟";
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) {
    return `${minutes} 分钟后`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return minutes % 60 === 0 ? `${hours} 小时后` : `${hours} 小时 ${minutes % 60} 分后`;
  }
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days} 天后` : `${days} 天 ${hours % 24} 小时后`;
}

export function formatRelativeTime(at: number, now: number = Date.now()): string {
  const diff = now - at;
  if (diff < 10_000) {
    return "刚刚";
  }
  if (diff < 60_000) {
    return `${Math.floor(diff / 1_000)} 秒前`;
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)} 分钟前`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)} 小时前`;
  }
  return `${Math.floor(diff / 86_400_000)} 天前`;
}
