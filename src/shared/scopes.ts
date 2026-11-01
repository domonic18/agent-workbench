/** 投影作用域(02 §4):SSE 帧按作用域携带 revision,前端与后端共用同一命名 */
export const OVERVIEW_SCOPE = "overview";

export function taskScopeName(taskId: string): string {
  return `task:${taskId}`;
}
