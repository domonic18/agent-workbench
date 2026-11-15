/**
 * 委派图的布局计算:纯函数,不碰 DOM。
 *
 * 版面恒定由算法算出(自动分层),不提供自由摆放——版面一旦随人手变化,
 * 就会从「一眼看清规则」退化成另一张蜘蛛网。
 *
 * 节点有两种:Agent 节点(发起方/收件方)与组节点(委派目标组)。
 * 组是**独立节点**:授权整组只画一条边,而不是给组内每个 Agent 各画一条。
 */
import type { AgentSummary } from "../../api/identity.js";
import type { AgentGroupSummary } from "../../api/types.js";
import { agentDisplayName } from "../../shared/agent-label.js";

export const AGENT_NODE_W = 176;
export const AGENT_NODE_H = 48;
export const GROUP_NODE_W = 208;
export const GROUP_NODE_H = 72;
export const COL_GAP = 88;
export const ROW_GAP = 20;
export const PAD = 32;
/** 节点右侧留给「连接手柄」的宽度:命中层不覆盖它,拖拽把手柄才点得到 */
export const HANDLE_W = 26;

export interface LayoutAgentNode {
  kind: "agent";
  key: string;
  agent: AgentSummary;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutGroupNode {
  kind: "group";
  key: string;
  group: AgentGroupSummary;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayoutNode = LayoutAgentNode | LayoutGroupNode;

export interface LayoutEdge {
  from: LayoutNode;
  to: LayoutNode;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

/**
 * 分层:发起方在左、收件方在右。
 *
 * 深度 = **到叶子(没有收件方)的最长路径**,层号 = 最深深度 - 自身深度。
 *
 * 为什么不用「从根出发的最长路径」:委派关系里有环(A→B→A),按入边算层时环上各点
 * 互相推高——实测 15 个 Agent 被拉成 7 列、版面横向爆炸、字小到看不清。
 * 按「能走多远」算,枢纽(随行-小W秘书 这种一个 Agent 指向一串收件方的)深度浅、
 * 落在最左列,收件方落在右侧,正是要看的结构。
 *
 * 环走 visiting 截断(该路径按 0 计),同库数据恒定同布局。
 */
export function layerLevels(agents: AgentSummary[]): Map<string, number> {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const outgoing = new Map<string, string[]>();
  for (const agent of agents) {
    for (const target of agent.allowedTargets) {
      if (target === agent.id || !byId.has(target)) {
        continue;
      }
      outgoing.set(agent.id, [...(outgoing.get(agent.id) ?? []), target]);
    }
  }
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  function depthOf(id: string): number {
    const known = depths.get(id);
    if (known !== undefined) {
      return known;
    }
    if (visiting.has(id)) {
      return 0;
    }
    visiting.add(id);
    let depth = 0;
    for (const target of outgoing.get(id) ?? []) {
      depth = Math.max(depth, 1 + depthOf(target));
    }
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  }
  for (const agent of agents) {
    depthOf(agent.id);
  }
  const maxDepth = Math.max(0, ...[...depths.values()]);
  const levels = new Map<string, number>();
  for (const [id, depth] of depths) {
    levels.set(id, maxDepth - depth);
  }
  return levels;
}

/** 中文名按拼音排(默认 localeCompare 对汉字按码位排,顺序不符合直觉) */
function byName(a: AgentSummary, b: AgentSummary): number {
  return agentDisplayName(a).localeCompare(agentDisplayName(b), "zh-Hans-CN");
}

/**
 * 排版:Agent 按层分列,组节点单独占末列。
 *
 * 边有两类:Agent→Agent(白名单里是 Agent id)与 Agent→组(白名单里是组 id)。
 * `targetsOf` 让调用方传草稿态的目标集合——图上画的边始终是**当前看到的**那一份,
 * 而不是已保存态。
 */
export function layoutGraph(
  agents: AgentSummary[],
  groups: AgentGroupSummary[] = [],
  targetsOf: (agent: AgentSummary) => readonly string[] = (agent) => agent.allowedTargets,
): GraphLayout {
  const levels = layerLevels(agents);
  const columns = new Map<number, AgentSummary[]>();
  for (const agent of agents) {
    const level = levels.get(agent.id) ?? 0;
    const column = columns.get(level) ?? [];
    column.push(agent);
    columns.set(level, column);
  }
  for (const column of columns.values()) {
    column.sort(byName);
  }
  const groupIds = new Set(groups.map((group) => group.id));
  const agentIds = new Set(agents.map((agent) => agent.id));
  const columnCount = columns.size + (groups.length > 0 ? 1 : 0);
  const agentRows = Math.max(1, ...[...columns.values()].map((column) => column.length));
  const groupRows = Math.max(1, groups.length);
  const maxRows = Math.max(agentRows, groupRows);
  const width = PAD * 2 + columnCount * AGENT_NODE_W + (columnCount - 1) * COL_GAP;
  const height = PAD * 2 + maxRows * AGENT_NODE_H + (maxRows - 1) * ROW_GAP;

  const nodes: LayoutNode[] = [];
  const position = new Map<string, LayoutNode>();
  for (const [level, column] of columns) {
    const offset = (maxRows - column.length) / 2;
    column.forEach((agent, index) => {
      const node: LayoutAgentNode = {
        kind: "agent",
        key: agent.id,
        agent,
        x: PAD + level * (AGENT_NODE_W + COL_GAP),
        y: PAD + (offset + index) * (AGENT_NODE_H + ROW_GAP),
        width: AGENT_NODE_W,
        height: AGENT_NODE_H,
      };
      nodes.push(node);
      position.set(agent.id, node);
    });
  }
  if (groups.length > 0) {
    const groupColumn = columns.size;
    const sorted = [...groups].sort((a, b) => a.name.localeCompare(b.name));
    sorted.forEach((group, index) => {
      const offset = (maxRows - sorted.length) / 2;
      const node: LayoutGroupNode = {
        kind: "group",
        key: group.id,
        group,
        x: PAD + groupColumn * (AGENT_NODE_W + COL_GAP),
        y: PAD + (offset + index) * (AGENT_NODE_H + ROW_GAP),
        width: GROUP_NODE_W,
        height: GROUP_NODE_H,
      };
      nodes.push(node);
      position.set(group.id, node);
    });
  }

  const edges: LayoutEdge[] = [];
  for (const agent of agents) {
    for (const target of targetsOf(agent)) {
      const to = position.get(target);
      if (to === undefined || target === agent.id) {
        continue;
      }
      const from = position.get(agent.id);
      if (from === undefined) {
        continue;
      }
      if (!agentIds.has(target) && !groupIds.has(target)) {
        continue;
      }
      edges.push({ from, to });
    }
  }
  return { nodes, edges, width, height };
}

/** 命中测试:点落在哪个节点上 */
export function nodeAt(nodes: readonly LayoutNode[], x: number, y: number): LayoutNode | null {
  for (const node of nodes) {
    if (x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height) {
      return node;
    }
  }
  return null;
}
