/** 本地日零点:跨时区部署时按控制台所在时区切日,与 03 §4.1 的「今日」一致 */
export function startOfLocalDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
