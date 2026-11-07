/**
 * 用户偏好持久化:localStorage 读写。
 * 隐私模式或配额写满时静默降级,偏好不是关键路径。
 */

export function readPreference(key: string, fallback: string): string {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw;
  } catch {
    return fallback;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 存不下就算了:本次会话仍然生效
  }
}
