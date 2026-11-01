import { createHash } from "node:crypto";

/** 统一换行后再算哈希,避免 CRLF 编辑造成无意义重嵌入 */
export function hashKnowledgeContent(content: string): string {
  return createHash("sha256").update(content.replace(/\r\n?/g, "\n")).digest("hex");
}
