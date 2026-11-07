import type { FastifyInstance } from "fastify";
import { receiverPrompt, senderPromptTemplate } from "../../mcp/agent-kit/prompts.js";
import { renderAgentGuide, renderAgentSkill } from "../../mcp/agent-kit/render.js";
import type { ConsoleTool } from "../../mcp/console-shared.js";
import type { Db } from "../../store/database.js";
import { requireSession } from "../middleware/session.js";

export interface AgentKitRoutesOptions {
  db: Db;
  /** 真实工具注册表:速查表由此派生,不改工具就自动同步 */
  tools: readonly ConsoleTool[];
  /** 对外可达的控制台地址;缺省时指南里写占位符 */
  publicUrl?: string | undefined;
  now?: () => number;
}

export interface AgentKitPayload {
  /** 人读的完整指南(Markdown) */
  guide: string;
  /** 可下载的 SKILL.md(Markdown) */
  skill: string;
  /** 可直接粘进工作区的提示词 */
  prompts: { receiver: string; senderTemplate: string };
  /** 对外可达的控制台地址;null 表示未配置,前端回退到当前访问地址 */
  publicUrl: string | null;
}

/**
 * Agent 接入材料(浏览器侧):规范正文、SKILL.md 与工作区提示词。
 * 内容全部由服务端渲染——同一份真源既供人读,也供 Agent 装成 skill。
 */
export function registerAgentKitRoutes(app: FastifyInstance, options: AgentKitRoutesOptions): void {
  const session = requireSession(options.db, options.now ?? Date.now);
  const render = (): AgentKitPayload => ({
    guide: renderAgentGuide(options.tools, { publicUrl: options.publicUrl }),
    skill: renderAgentSkill(options.tools, { publicUrl: options.publicUrl }),
    prompts: { receiver: receiverPrompt(), senderTemplate: senderPromptTemplate() },
    publicUrl: options.publicUrl ?? null,
  });

  app.get("/api/agent-kit/guide", { preHandler: [session] }, async () => render());

  app.get("/api/agent-kit/skill", { preHandler: [session] }, async (_request, reply) =>
    reply
      .header("content-type", "text/markdown; charset=utf-8")
      .header("content-disposition", 'attachment; filename="SKILL.md"')
      .send(render().skill),
  );
}
