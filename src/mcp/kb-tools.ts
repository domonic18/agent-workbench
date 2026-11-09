import { KNOWLEDGE_LIMITS } from "../shared/constants.js";
import { writeKnowledgeCandidate } from "../domain/knowledge/agent-write.js";
import { searchKnowledge } from "../domain/knowledge/retrieval.js";
import {
  errorResult,
  optionalText,
  textResult,
  type ConsoleTool,
  type ConsoleToolDeps,
} from "./console-shared.js";

const KB_SEARCH_LIMIT_MAX = 20;

/**
 * 知识两工具(kb.search / kb.write):检索只读,写入只产 candidate。
 * 路径与正文长度由 schema 与领域层双重约束,模型自述的来源任务必须属于自己。
 */
export function createKbTools(deps: ConsoleToolDeps): ConsoleTool[] {
  return [
    {
      name: "kb_search",
      gateName: "kb.search",
      description: "知识检索:返回带出处的知识片段(条目 id / 路径 / 命中分块),只读不改。",
      inputSchema: {
        type: "object",
        properties: {
          search: { type: "string", description: "关键词,空串无意义" },
          limit: { type: "integer", minimum: 1, maximum: KB_SEARCH_LIMIT_MAX },
        },
        required: ["search"],
      },
      auditTaskId: () => null,
      execute: async (_agent, args) => {
        const search = optionalText(args.search);
        if (search === undefined) {
          return errorResult("search 必填");
        }
        const limit = args.limit;
        if (
          limit !== undefined &&
          (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > KB_SEARCH_LIMIT_MAX)
        ) {
          return errorResult(`limit 须为 1~${KB_SEARCH_LIMIT_MAX} 的整数`);
        }
        const hits = await searchKnowledge(deps.db, { search, ...(limit === undefined ? {} : { limit }) });
        return textResult({ hits });
      },
    },
    {
      name: "kb_write",
      gateName: "kb.write",
      description:
        "写入知识候选(状态恒 candidate,采纳只能由人在控制台完成);来源任务必须属于当前 Agent,路径不得触碰受保护文件。",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "自己名下的任务" },
          path: { type: "string", description: "知识目录内相对路径,如 notes/bug-fix.md" },
          title: { type: "string", maxLength: KNOWLEDGE_LIMITS.title },
          summary: { type: "string", maxLength: KNOWLEDGE_LIMITS.summary },
          category: { type: "string", maxLength: KNOWLEDGE_LIMITS.category },
          content: { type: "string", maxLength: KNOWLEDGE_LIMITS.content, description: "Markdown 正文" },
        },
        required: ["task_id", "path", "title", "content"],
      },
      auditTaskId: (args) => optionalText(args.task_id) ?? null,
      execute: async (agent, args) => {
        const taskId = optionalText(args.task_id);
        const path = optionalText(args.path);
        const title = optionalText(args.title);
        const content = typeof args.content === "string" ? args.content : undefined;
        if (taskId === undefined || path === undefined || title === undefined || content === undefined) {
          return errorResult("task_id、path、title 与 content 必填");
        }
        const written = await writeKnowledgeCandidate(
          agent,
          {
            taskId,
            path,
            title,
            summary: optionalText(args.summary),
            category: optionalText(args.category),
            content,
          },
          { db: deps.db, knowledgeDir: deps.knowledgeDir },
        );
        return textResult(written);
      },
    },
  ];
}
