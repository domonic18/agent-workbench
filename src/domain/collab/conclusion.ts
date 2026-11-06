import type { Db } from "../../store/database.js";
import { findLatestReplySummary } from "../../store/repositories/a2a.js";
import { findKnowledgeEntry } from "../../store/repositories/knowledge.js";
import { findTaskById, listChildTaskIds } from "../../store/repositories/task.js";

/** 结论在群卡片里的长度上限:摘要过长会撑爆卡片,截断后加省略号 */
const CONCLUSION_MAX = 400;

/**
 * 任务结论摘要(2026-11-06 用户反馈:完成播报只说「已闭环」,没有结论文字)。
 * 取数顺序:
 * 1. 本任务最近一条 A2A 回执正文(reply.summary)——下游回传的实际结论
 * 2. task.output 指向的知识条目摘要——结论已沉淀进知识库的情形
 * 3. 子任务最近一条回执正文——根任务被系统收口时,结论来自下游
 * 都没有则 null:播报不写「结论」行,也不编内容。
 */
export async function resolveConclusion(db: Db, taskId: string): Promise<string | null> {
  const own = await findLatestReplySummary(db, [taskId]);
  const ownText = own === null ? null : truncate(own);
  if (ownText !== null) {
    return ownText;
  }

  const task = await findTaskById(db, taskId);
  if (task === undefined) {
    return null;
  }
  const fromOutput = await conclusionFromOutput(db, task.output);
  if (fromOutput !== null) {
    return fromOutput;
  }

  const childIds = await listChildTaskIds(db, taskId);
  const fromChild = await findLatestReplySummary(db, childIds);
  return fromChild === null ? null : truncate(fromChild);
}

/** task.output 是索引(知识条目 id 或 http(s) 链接),本身不是结论正文 */
async function conclusionFromOutput(db: Db, output: string | null): Promise<string | null> {
  if (output === null || !output.startsWith("kb_")) {
    return null;
  }
  const entry = await findKnowledgeEntry(db, output);
  if (entry === undefined) {
    return null;
  }
  const text = entry.summary === "" ? entry.title : entry.summary;
  return truncate(text);
}

function truncate(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  return trimmed.length <= CONCLUSION_MAX ? trimmed : `${trimmed.slice(0, CONCLUSION_MAX)}…`;
}
