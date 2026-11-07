import { api } from "./client.js";

/** 工作区提示词:接收侧与发起侧各一份 */
export interface AgentKitPrompts {
  receiver: string;
  senderTemplate: string;
}

export interface AgentKit {
  /** 人读的完整规范 Markdown */
  guide: string;
  /** Claude Code skill 格式的 SKILL.md 正文 */
  skill: string;
  prompts: AgentKitPrompts;
  /** 对外可达的控制台地址;null 表示未配置,前端回退到当前访问地址 */
  publicUrl: string | null;
}

export function fetchAgentKit(): Promise<AgentKit> {
  return api.get<AgentKit>("/api/agent-kit/guide");
}
