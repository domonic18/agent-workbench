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

/**
 * 归一化路径段:折叠 `.` 与 `..`,去掉空段。
 * 与 resolve 同义地回答「最终落在哪个文件上」,但不需要知识目录即可判断。
 */
function normalizedSegments(path: string): string[] {
  const stack: string[] = [];
  for (const segment of path.split(/[\\/]+/)) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack;
}

/**
 * index.md / log.md 只读(02 §3.5):按最终落盘的文件名判定,大小写不敏感。
 * 必须先归一化——`index.md/`、`index.md/.`、`a/../index.md` 都落在 index.md 上,
 * 按原始路径取末段会被绕开。
 */
export function isProtectedKnowledgePath(path: string): boolean {
  const name = normalizedSegments(path).at(-1)?.toLowerCase() ?? "";
  return (KNOWLEDGE_PROTECTED_FILES as readonly string[]).includes(name);
}

/**
 * 归一化后的相对路径(以 / 分隔)。同一文件只留一条路径形态,
 * 免得 `./notes/x.md` 与 `notes/x.md` 各占一条知识条目、却指向同一个文件。
 */
export function normalizeKnowledgePath(path: string): string {
  return normalizedSegments(path).join("/");
}
