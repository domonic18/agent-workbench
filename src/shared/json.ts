/** 解析 JSON 列;坏值退化为空对象,避免一条脏数据拖垮整个读模型 */
export function parseJsonObject(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return {};
  }
}
