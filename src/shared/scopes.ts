/** 投影作用域(02 §4):SSE 帧按作用域携带 revision,前端与后端共用同一命名 */
export const OVERVIEW_SCOPE = "overview";

export function taskScopeName(taskId: string): string {
  return `task:${taskId}`;
}

/** 订阅参数只接受已知形态:overview 或 task:<id>,避免拼出任意作用域名 */
export function isScopeName(value: string): boolean {
  return value === OVERVIEW_SCOPE || /^task:[A-Za-z0-9_-]+$/.test(value);
}
