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

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatDateTime(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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
