/** 下钻抽屉的返回路径:跳转方把来源路径放进 location.state.from(03 §3) */
export function navFrom(state: unknown): string | undefined {
  if (typeof state !== "object" || state === null) {
    return undefined;
  }
  const from = (state as { from?: unknown }).from;
  return typeof from === "string" && from.startsWith("/") ? from : undefined;
}
