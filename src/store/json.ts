/** 解析 JSON 字符串数组列(如 refs_json / allowed_targets_json);坏值退化为空数组 */
export function parseJsonStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
