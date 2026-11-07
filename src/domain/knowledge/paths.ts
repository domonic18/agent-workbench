import { resolve, sep } from "node:path";
import { KNOWLEDGE_PROTECTED_FILES } from "../../shared/constants.js";

/** 相对路径解析到知识目录内;越界即拒绝,防止 `../` 读写目录外文件 */
export function resolveEntryPath(knowledgeDir: string, path: string): string {
  const root = resolve(knowledgeDir);
  const fullPath = resolve(root, path);
  if (!fullPath.startsWith(root + sep)) {
    throw new Error(`知识路径越出知识目录: ${path}`);
  }
  return fullPath;
}

/** index.md / log.md 只读(02 §3.5):按文件名判定,大小写不敏感 */
export function isProtectedKnowledgePath(path: string): boolean {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  return (KNOWLEDGE_PROTECTED_FILES as readonly string[]).includes(name);
}
