import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { newPrefixedId } from "../../shared/ids.js";
import type { Db } from "../../store/database.js";
import { findTaskOwnedBy } from "../../store/repositories/task.js";
import { findKnowledgeEntryByPath, insertKnowledgeEntry } from "../../store/repositories/knowledge.js";
import type { AgentRecord } from "../../store/repositories/agent.js";
import { KnowledgeError } from "./entry-service.js";
import { isProtectedKnowledgePath, resolveEntryPath } from "./paths.js";

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
  if (isProtectedKnowledgePath(path)) {
    throw new KnowledgeError("PROTECTED", `受保护文件只读: ${path}`);
  }
  if ((await findTaskOwnedBy(deps.db, input.taskId, agent.id)) === undefined) {
    throw new KnowledgeError("CONFLICT", `任务 ${input.taskId} 不存在或不属于当前 Agent`);
  }
  if ((await findKnowledgeEntryByPath(deps.db, path)) !== undefined) {
    throw new KnowledgeError("CONFLICT", `知识路径已存在: ${path}`);
  }

  resolveEntryPath(deps.knowledgeDir, path); // 越界即抛
  const fullPath = resolveEntryPath(deps.knowledgeDir, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");

  const at = (deps.now ?? Date.now)();
  const id = (deps.newId ?? (() => newPrefixedId("kb")))();
  await insertKnowledgeEntry(deps.db, {
    id,
    path,
    title,
    summary: input.summary?.trim() ?? "",
    category: input.category?.trim() ?? "",
    status: "candidate",
    sourceTaskId: input.taskId,
    sourceAgentId: agent.id,
    createdAt: at,
  });
  return { id, path };
}
