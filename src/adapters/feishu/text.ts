/**
 * 飞书 text 消息的 content 是 JSON 字符串(`{"text":"..."}`),群消息正文里
 * 的 @ 是 `@_user_N` 占位符,解析指令前统一剥掉(01 §8.1)。
 */
const MENTION = /@_user_\d+/g;

export function extractText(content: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const text = (parsed as { text?: unknown }).text;
  if (typeof text !== "string") {
    return undefined;
  }
  return text.replace(MENTION, " ").replace(/\s+/g, " ").trim();
}
