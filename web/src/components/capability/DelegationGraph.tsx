import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { AgentSummary } from "../../api/identity.js";
import { agentDisplayName } from "../../shared/agent-label.js";
import { Button } from "../ui/Button.js";
import type { DelegationDraft } from "./useDelegationDraft.js";
import styles from "./DelegationGraph.module.css";

const NODE_W = 176;
const NODE_H = 48;
const COL_GAP = 96;
const ROW_GAP = 20;
const PAD = 24;
const NAME_MAX = 9;

interface GraphNode {
  agent: AgentSummary;
  x: number;
  y: number;
}

interface GraphEdge {
  from: GraphNode;
  to: GraphNode;
}

/**
 * 确定性分层:收件方 level = max(发起方 level)+1,无入边为 0;
 * 环走 visiting 截断(该路径按 0 计),同库数据恒定同布局。
 */
function layerLevels(agents: AgentSummary[]): Map<string, number> {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const incoming = new Map<string, string[]>();
  for (const agent of agents) {
    for (const target of agent.allowedTargets) {
      if (target === agent.id || !byId.has(target)) {
        continue;
      }
      const sources = incoming.get(target) ?? [];
      sources.push(agent.id);
      incoming.set(target, sources);
    }
  }
  const levels = new Map<string, number>();
  const visiting = new Set<string>();
  function levelOf(id: string): number {
    const known = levels.get(id);
    if (known !== undefined) {
      return known;
    }
    if (visiting.has(id)) {
      return 0;
    }
    visiting.add(id);
    let level = 0;
    for (const source of incoming.get(id) ?? []) {
      level = Math.max(level, levelOf(source) + 1);
    }
    visiting.delete(id);
    levels.set(id, level);
    return level;
  }
  for (const agent of agents) {
    levelOf(agent.id);
  }
  return levels;
}

function layoutGraph(agents: AgentSummary[]): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
} {
  const levels = layerLevels(agents);
  const columns = new Map<number, AgentSummary[]>();
  for (const agent of agents) {
    const level = levels.get(agent.id) ?? 0;
    const column = columns.get(level) ?? [];
    column.push(agent);
    columns.set(level, column);
  }
  for (const column of columns.values()) {
    column.sort((a, b) => agentDisplayName(a).localeCompare(agentDisplayName(b)));
  }
  const columnCount = columns.size;
  const maxRows = Math.max(1, ...[...columns.values()].map((column) => column.length));
  const width = PAD * 2 + columnCount * NODE_W + (columnCount - 1) * COL_GAP;
  const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP;

  const position = new Map<string, GraphNode>();
  for (const [level, column] of columns) {
    const offset = (maxRows - column.length) / 2;
    column.forEach((agent, index) => {
      position.set(agent.id, {
        agent,
        x: PAD + level * (NODE_W + COL_GAP),
        y: PAD + (offset + index) * (NODE_H + ROW_GAP),
      });
    });
  }
  const nodes = [...position.values()];
  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    for (const target of node.agent.allowedTargets) {
      const to = position.get(target);
      if (to !== undefined && target !== node.agent.id) {
        edges.push({ from: node, to });
      }
    }
  }
  return { nodes, edges, width, height };
}

function shorten(name: string): string {
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;
}

export interface DelegationGraphProps {
  draft: DelegationDraft;
}

/** 委派关系图:节点=Agent,箭头=发起方→收件方;点节点编辑其收件方 */
export function DelegationGraph({ draft }: DelegationGraphProps) {
  const { agents, selection } = draft;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { nodes, edges, width, height } = useMemo(() => layoutGraph(agents), [agents]);
  const selected = agents.find((agent) => agent.id === selectedId) ?? null;
  const recipients = selected
    ? (selection[selected.id] ?? [])
        .map((id) => agents.find((agent) => agent.id === id))
        .filter((agent): agent is AgentSummary => agent !== undefined)
    : [];
  const candidates = selected
    ? agents.filter(
        (agent) => agent.id !== selected.id && !(selection[selected.id] ?? []).includes(agent.id),
      )
    : [];

  return (
    <div className={styles.wrapper}>
      <div className={styles.canvasWrap}>
        <div className={styles.canvas} style={{ width, height }}>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label="委派关系图"
        >
          <defs>
            <marker
              id="aw-delegation-arrow"
              viewBox="0 0 8 8"
              refX={7}
              refY={4}
              markerWidth={7}
              markerHeight={7}
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" className={styles.arrowHead} />
            </marker>
          </defs>
          {edges.map((edge) => {
            const x1 = edge.from.x + NODE_W;
            const y1 = edge.from.y + NODE_H / 2;
            const x2 = edge.to.x;
            const y2 = edge.to.y + NODE_H / 2;
            const bend = COL_GAP * 0.6;
            const active =
              selectedId !== null && (edge.from.agent.id === selectedId || edge.to.agent.id === selectedId);
            return (
              <path
                key={`${edge.from.agent.id}->${edge.to.agent.id}`}
                d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
                className={active ? styles.edgeActive : styles.edge}
                markerEnd="url(#aw-delegation-arrow)"
              />
            );
          })}
          {nodes.map((node) => {
            const name = agentDisplayName(node.agent);
            const count = (selection[node.agent.id] ?? []).length;
            const active = node.agent.id === selectedId;
            return (
              <g key={node.agent.id}>
                <rect
                  x={node.x}
                  y={node.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={10}
                  className={active ? styles.nodeRectActive : styles.nodeRect}
                >
                  <title>{name}</title>
                </rect>
                <circle
                  cx={node.x + 24}
                  cy={node.y + NODE_H / 2}
                  r={13}
                  className={styles.nodeAvatar}
                />
                <text
                  x={node.x + 24}
                  y={node.y + NODE_H / 2 + 1}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={styles.nodeInitial}
                >
                  {shorten(name).slice(0, 1).toUpperCase()}
                </text>
                <text
                  x={node.x + 44}
                  y={node.y + NODE_H / 2 + 1}
                  dominantBaseline="central"
                  className={styles.nodeName}
                >
                  {shorten(name)}
                  <title>{name}</title>
                </text>
                {count > 0 ? (
                  <g>
                    <rect
                      x={node.x + NODE_W - 42}
                      y={node.y + NODE_H / 2 - 9}
                      width={34}
                      height={18}
                      rx={9}
                      className={styles.countRect}
                    />
                    <text
                      x={node.x + NODE_W - 25}
                      y={node.y + NODE_H / 2 + 1}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className={styles.countText}
                    >
                      →{count}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>
        {nodes.map((node) => (
          <button
            key={node.agent.id}
            type="button"
            className={styles.hit}
            style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
            aria-label={`${agentDisplayName(node.agent)}（委派 ${(selection[node.agent.id] ?? []).length} 方）`}
            aria-pressed={node.agent.id === selectedId}
            onClick={() =>
              setSelectedId((current) => (current === node.agent.id ? null : node.agent.id))
            }
          />
        ))}
        </div>
      </div>

      {selected === null ? (
        <p className={styles.pickHint}>点击节点，编辑该 Agent 可以委派给谁。</p>
      ) : (
        <div className={styles.editor} role="group" aria-label="委派编辑面板">
          <h3 className={styles.editorTitle}>{agentDisplayName(selected)} 可委派给</h3>
          <div className={styles.chips}>
            {recipients.length === 0 ? (
              <span className={styles.chipsEmpty}>暂无收件方</span>
            ) : (
              recipients.map((recipient) => (
                <span key={recipient.id} className={styles.chip}>
                  {agentDisplayName(recipient)}
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={`移除 ${agentDisplayName(recipient)}`}
                    onClick={() => draft.toggle(selected, recipient)}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))
            )}
          </div>
          <div className={styles.addRow}>
            {candidates.length === 0 ? (
              <span className={styles.chipsEmpty}>没有其他 Agent 可添加</span>
            ) : (
              <label className={styles.addLabel}>
                添加收件方
                <select
                  className={styles.select}
                  value=""
                  onChange={(event) => {
                    const next = agents.find((agent) => agent.id === event.target.value);
                    if (next !== undefined) {
                      draft.toggle(selected, next);
                    }
                  }}
                >
                  <option value="" disabled>
                    选择 Agent
                  </option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {agentDisplayName(candidate)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button
              variant="primary"
              disabled={draft.pending || draft.dirty.length === 0}
              onClick={() => void draft.save()}
            >
              {draft.pending ? "保存中…" : "保存委派"}
            </Button>
          </div>
          {draft.dirty.length === 0 ? null : (
            <p className={styles.dirtyNote}>{draft.dirty.length} 个发起方有未保存的改动。</p>
          )}
          {draft.error === null ? null : (
            <p className={styles.error} role="alert">
              {draft.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
