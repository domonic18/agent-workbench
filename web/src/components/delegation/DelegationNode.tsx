/**
 * 图上的节点与边:Agent 节点(头像 + 名字 + 出边计数)与组节点(成员数 + 成员名),
 * 以及节点之间的连线形状。
 */
import { agentDisplayName } from "../../shared/agent-label.js";
import {
  AGENT_NODE_H,
  AGENT_NODE_W,
  GROUP_NODE_H,
  GROUP_NODE_W,
  type LayoutNode,
} from "./layout.js";
import styles from "./DelegationCanvas.module.css";

const NAME_MAX = 9;

function shorten(name: string): string {
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;
}

/** 发起方 → 收件方的连线:横向贝塞尔,箭头落在收件方左侧 */
export function edgePath(from: LayoutNode, to: LayoutNode): string {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const bend = Math.max(40, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

export interface DelegationNodeProps {
  node: LayoutNode;
  active: boolean;
  /** 组内成员的展示名(组节点用) */
  memberNames: string[];
}

/** 节点图形:矩形 + 头像 + 名字 + 右侧连接手柄 */
export function DelegationNode({ node, active, memberNames }: DelegationNodeProps) {
  const width = node.kind === "agent" ? AGENT_NODE_W : GROUP_NODE_W;
  const height = node.kind === "agent" ? AGENT_NODE_H : GROUP_NODE_H;
  const name = node.kind === "agent" ? agentDisplayName(node.agent) : node.group.name;
  const count = node.kind === "group" ? node.group.memberIds.length : 0;
  return (
    <g>
      <rect
        x={node.x}
        y={node.y}
        width={width}
        height={height}
        rx={10}
        className={active ? styles.nodeRectActive : styles.nodeRect}
      >
        <title>{name}</title>
      </rect>
      <circle
        cx={node.x + 24}
        cy={node.y + height / 2}
        r={13}
        className={node.kind === "group" ? styles.groupAvatar : styles.nodeAvatar}
      />
      <text
        x={node.x + 24}
        y={node.y + height / 2 + 1}
        textAnchor="middle"
        dominantBaseline="central"
        className={node.kind === "group" ? styles.groupInitial : styles.nodeInitial}
      >
        {node.kind === "group" ? "组" : shorten(name).slice(0, 1).toUpperCase()}
      </text>
      <text
        x={node.x + 44}
        y={node.y + (node.kind === "group" ? 22 : height / 2 + 1)}
        dominantBaseline="central"
        className={styles.nodeName}
      >
        {shorten(name)}
        <title>{name}</title>
      </text>
      {node.kind === "group" ? (
        <text x={node.x + 44} y={node.y + 46} className={styles.groupMeta}>
          {count} 个成员{memberNames.length > 0 ? ` · ${memberNames.slice(0, 2).join("、")}` : ""}
        </text>
      ) : null}
      <circle
        cx={node.x + width - 13}
        cy={node.y + height / 2}
        r={7}
        className={styles.handle}
        data-handle="1"
        data-node-key={node.key}
      >
        <title>拖到目标节点可建立委派</title>
      </circle>
    </g>
  );
}
