/**
 * Agent 展示名口径:飞书群里 @ 的是 bot 名,不是 cc-connect 项目名。
 * Agent 自报 bot 名之前回退控制台 displayName,两处都没有才显示裸 id。
 */

export interface NamedAgent {
  id: string;
  displayName: string;
  feishuBotName: string | null;
}

/** 展示名:飞书 bot 名优先,回退控制台 displayName */
export function agentDisplayName(agent: NamedAgent): string {
  return agent.feishuBotName ?? agent.displayName;
}

/** 引用写法:@机器人名,与飞书群里的称呼一致 */
export function agentMention(agent: NamedAgent): string {
  return `@${agentDisplayName(agent)}`;
}

/** id → 展示名 的映射,取不到时显示裸 id */
export function agentNameMap(
  agents: readonly NamedAgent[],
): Map<string, string> {
  return new Map(agents.map((agent) => [agent.id, agentDisplayName(agent)]));
}

/**
 * 引用写法:名册里有就用 @机器人名,没有则原样返回后端标签
 * (已删除 Agent 的「已删除 X」不该带 @)。
 */
export function agentMentionLabel(
  id: string,
  names: ReadonlyMap<string, string> | undefined,
  fallback: string,
): string {
  const name = names?.get(id);
  return name === undefined ? fallback : `@${name}`;
}

/**
 * 该 Agent 有没有 aw-node 过程数据:只有 claude_code 且绑定了机器的 Agent 才有。
 * 外部运行时(WorkBuddy 等)即使登记了宿主机器,也没有采集器,固定显示「未接入」。
 */
export function hasCollector(agent: {
  runtime: string;
  machineId: string | null;
}): boolean {
  return agent.runtime === "claude_code" && agent.machineId !== null;
}
