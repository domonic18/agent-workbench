/** 飞书接口统一以 code=0 表示成功;非 0 时把 code/msg 带进错误,便于定位 */
export function ensureOk(
  response: { code?: number | undefined; msg?: string | undefined },
  action: string,
): void {
  const code = response.code ?? 0;
  if (code !== 0) {
    throw new Error(`飞书${action}失败: code=${code} msg=${response.msg ?? ""}`);
  }
}
