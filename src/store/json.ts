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

/** 替换符 U+FFFD:标出「此处原有一个 PG 存不下的字符」 */
const REPLACEMENT = "\uFFFD";

/**
 * 替换 PostgreSQL jsonb 存不下的字符:NUL 与孤立代理项。
 * jsonb 的转义解析拒绝这两类(22P02 unsupported Unicode escape sequence),
 * 一条带这类字符的事件会让整批入库失败,进而把整条采集流堵死。
 */
function sanitizeText(text: string): string {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0) {
      out += REPLACEMENT;
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[index] ?? "";
        out += text[index + 1] ?? "";
        index += 1;
        continue;
      }
      out += REPLACEMENT;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      out += REPLACEMENT;
      continue;
    }
    out += text[index];
  }
  return out;
}

/** 递归清洗任意 JSON 值:字符串与对象键中的非法字符换成替换符 */
export function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item));
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[sanitizeText(key)] = sanitizeJsonValue(item);
    }
    return out;
  }
  return value;
}

/** 落 jsonb 列的文本:先清洗再序列化,保证 CHECK (payload_json::jsonb) 不炸 */
export function toJsonbText(value: unknown): string {
  return JSON.stringify(sanitizeJsonValue(value ?? {}));
}
