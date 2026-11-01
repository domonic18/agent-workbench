import { KNOWLEDGE_INDEX } from "../../shared/constants.js";

function splitLongBlock(block: string): string[] {
  const chars = Array.from(block);
  const parts: string[] = [];
  for (let start = 0; start < chars.length; start += KNOWLEDGE_INDEX.chunkMaxChars) {
    parts.push(chars.slice(start, start + KNOWLEDGE_INDEX.chunkMaxChars).join("").trim());
  }
  return parts.filter((part) => part !== "");
}

/**
 * 按空行切段再合并到上限;超长段按码点硬切,避免把代理对劈成半个字符。
 * 切分只服务检索,不改变 Markdown 真相源。
 */
export function splitMarkdown(content: string): string[] {
  const normalized = content.replace(/\r\n?/g, "\n").trim();
  if (normalized === "") {
    return [];
  }
  const blocks = normalized
    .split(/\n{2,}/)
    .flatMap((block) => splitLongBlock(block.trim()))
    .filter((block) => block !== "");

  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    if (current === "") {
      current = block;
    } else if (current.length + 2 + block.length <= KNOWLEDGE_INDEX.chunkMaxChars) {
      current = `${current}\n\n${block}`;
    } else {
      chunks.push(current);
      current = block;
    }
  }
  if (current !== "") {
    chunks.push(current);
  }
  return chunks;
}
