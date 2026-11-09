import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { newPrefixedId } from "../../shared/ids.js";
import { KNOWLEDGE_LIMITS } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { findTaskOwnedBy } from "../../store/repositories/task.js";
import { findKnowledgeEntryByPath, insertKnowledgeEntry } from "../../store/repositories/knowledge.js";
import type { AgentRecord } from "../../store/repositories/agent.js";
import { KnowledgeError } from "./entry-service.js";
import { isProtectedKnowledgePath, normalizeKnowledgePath, resolveEntryPath } from "./paths.js";

export interface KnowledgeCandidateInput {
  taskId: string;
  /** 知识目录内的相对路径,如 `notes/bug-fix.md` */
  path: string;
  title: string;
  summary?: string | undefined;
  category?: string | undefined;
  content: string;
}

export interface WriteKnowledgeCandidateDeps {
  db: Db;
  knowledgeDir: string;
  now?: () => number;
  newId?: () => string;
}

/**
 * kb.write(L1):Agent 经 /mcp 落知识候选。
 * 来源任务必须属于本 Agent(05 §6.1),路径不得越界/触碰受保护文件,状态恒 candidate——采纳只能由人完成。
 */
export async function writeKnowledgeCandidate(
  agent: Pick<AgentRecord, "id">,
  input: KnowledgeCandidateInput,
  deps: WriteKnowledgeCandidateDeps,
): Promise<{ id: string; path: string }> {
  const path = input.path.trim();
  const title = input.title.trim();
  const content = input.content;
  if (path === "" || title === "" || content.trim() === "") {
    throw new KnowledgeError("CONFLICT", "path、title 与 content 均必填");
  }
  // 越界先按原路径判:`../` 逃逸不能被归一化掩盖成目录内的另一个文件
  const fullPath = resolveEntryPath(deps.knowledgeDir, path);
  const normalizedPath = normalizeKnowledgePath(path);
  if (isProtectedKnowledgePath(fullPath)) {
    throw new KnowledgeError("PROTECTED", `受保护文件只读: ${path}`);
  }
  if (content.length > KNOWLEDGE_LIMITS.content) {
    throw new KnowledgeError(
      "VALIDATION_FAILED",
      `正文超长,上限 ${KNOWLEDGE_LIMITS.content} 字符`,
    );
  }
  if ((await findTaskOwnedBy(deps.db, input.taskId, agent.id)) === undefined) {
    throw new KnowledgeError("CONFLICT", `任务 ${input.taskId} 不存在或不属于当前 Agent`);
  }
  // 查重按归一化路径:同一文件的别名写法不能绕过「已存在」检查去覆盖别人已采纳的内容
  if ((await findKnowledgeEntryByPath(deps.db, normalizedPath)) !== undefined) {
    throw new KnowledgeError("CONFLICT", `知识路径已存在: ${normalizedPath}`);
  }

  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");

  const at = (deps.now ?? Date.now)();
  const id = (deps.newId ?? (() => newPrefixedId("kb")))();
  await insertKnowledgeEntry(deps.db, {
    id,
    path: normalizedPath,
    title,
    summary: input.summary?.trim() ?? "",
    category: input.category?.trim() ?? "",
    status: "candidate",
    sourceTaskId: input.taskId,
    sourceAgentId: agent.id,
    createdAt: at,
  });
  return { id, path: normalizedPath };
}
