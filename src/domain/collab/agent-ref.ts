import type { AgentRecord } from "../../store/repositories/identity.js";
import type { CollabAgentRef } from "./notice.js";

/** 渲染协作卡片时优先使用 Agent 自报的飞书 bot 名称,回退到控制台 displayName */
export function agentRef(agent: AgentRecord): CollabAgentRef {
  return { id: agent.id, displayName: agent.feishuBotName ?? agent.displayName };
}
