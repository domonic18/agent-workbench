import type { OverviewAgent } from "../../api/types.js";
import {
  formatDateTime,
  formatExactTokens,
  formatRelativeTime,
  formatTokens,
} from "../../shared/format.js";
import { HEARTBEAT_LABEL, HEARTBEAT_TONE } from "../../shared/labels.js";
import { StatusBadge } from "./StatusBadge.js";
import styles from "./AgentTable.module.css";

export interface AgentTableProps {
  agents: readonly OverviewAgent[];
  now?: number;
  onManageKey?: (agent: OverviewAgent) => void;
}

export function AgentTable({ agents, now, onManageKey }: AgentTableProps) {
  return (
    <>
      <div className={styles.wrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Agent</th>
              <th>机器</th>
              <th>项目</th>
              <th>当前任务</th>
              <th>状态</th>
              <th>最近事件</th>
              <th className={styles.numeric}>今日 Token</th>
              {onManageKey === undefined ? null : <th>密钥</th>}
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id}>
                <td>
                  <div className={styles.primary}>{agent.displayName}</div>
                  <div className={styles.mono}>{agent.id}</div>
                </td>
                <td>{agent.machineHostname}</td>
                <td>{agent.project}</td>
                <td>
                  {agent.currentTaskId === null ? (
                    <span className={styles.muted}>—</span>
                  ) : (
                    <>
                      <div>{agent.currentTaskTitle ?? agent.currentTaskId}</div>
                      <div className={styles.muted}>
                        {agent.currentTaskStage ?? ""}
                        {agent.currentTaskStatus === null ? "" : ` · ${agent.currentTaskStatus}`}
                      </div>
                    </>
                  )}
                </td>
                <td>
                  <StatusBadge
                    tone={HEARTBEAT_TONE[agent.heartbeat]}
                    text={HEARTBEAT_LABEL[agent.heartbeat]}
                  />
                  <div className={styles.muted}>{agent.running ? "运行中" : "空闲"}</div>
                </td>
                <td
                  title={agent.lastRunAt === null ? undefined : formatDateTime(agent.lastRunAt)}
                >
                  {agent.lastRunAt === null
                    ? "从未运行"
                    : formatRelativeTime(agent.lastRunAt, now)}
                </td>
                <td className={styles.numeric} title={formatExactTokens(agent.todayTokens)}>
                  {formatTokens(agent.todayTokens)}
                </td>
                {onManageKey === undefined ? null : (
                  <td>
                    <button
                      type="button"
                      className={styles.keyButton}
                      onClick={() => onManageKey(agent)}
                      aria-label={`管理 ${agent.displayName} 的密钥`}
                    >
                      密钥
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 移动端卡片保留 Agent / 当前任务 / 状态三列,其余压缩为次要信息(03 §8) */}
      <ul className={styles.cards} aria-label="Agent 卡片">
        {agents.map((agent) => (
          <li key={agent.id} className={styles.card}>
            <div className={styles.cardTop}>
              <div>
                <div className={styles.primary}>{agent.displayName}</div>
                <div className={styles.mono}>{agent.id}</div>
              </div>
              <StatusBadge
                tone={HEARTBEAT_TONE[agent.heartbeat]}
                text={HEARTBEAT_LABEL[agent.heartbeat]}
              />
            </div>
            <div className={styles.cardTask}>
              <span className={styles.cardLabel}>当前任务</span>
              {agent.currentTaskId === null ? (
                <span className={styles.muted}>—</span>
              ) : (
                <>
                  <div>{agent.currentTaskTitle ?? agent.currentTaskId}</div>
                  <div className={styles.muted}>
                    {agent.currentTaskStage ?? ""}
                    {agent.currentTaskStatus === null ? "" : ` · ${agent.currentTaskStatus}`}
                  </div>
                </>
              )}
            </div>
            <div className={styles.cardMeta}>
              <span>
                {agent.machineHostname} · {agent.project}
              </span>
              <span>{agent.running ? "运行中" : "空闲"}</span>
              <span title={agent.lastRunAt === null ? undefined : formatDateTime(agent.lastRunAt)}>
                {agent.lastRunAt === null
                  ? "从未运行"
                  : formatRelativeTime(agent.lastRunAt, now)}
              </span>
              <span title={formatExactTokens(agent.todayTokens)}>
                {formatTokens(agent.todayTokens)} Token
              </span>
            </div>
            {onManageKey === undefined ? null : (
              <button
                type="button"
                className={styles.keyButton}
                onClick={() => onManageKey(agent)}
                aria-label={`管理 ${agent.displayName} 的密钥`}
              >
                密钥
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
