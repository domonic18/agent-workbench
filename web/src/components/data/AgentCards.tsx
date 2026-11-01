import type { OverviewAgent } from "../../api/types.js";
import {
  formatDateTime,
  formatExactTokens,
  formatRelativeTime,
  formatTokens,
} from "../../shared/format.js";
import {
  HEARTBEAT_LABEL,
  HEARTBEAT_TONE,
  TASK_STAGE_LABEL,
  TASK_STATUS_LABEL,
  type Tone,
} from "../../shared/labels.js";
import styles from "./AgentCards.module.css";

export interface AgentCardsProps {
  agents: readonly OverviewAgent[];
  now?: number;
  onManageKey?: (agent: OverviewAgent) => void;
}

const TONE_CLASS: Record<Tone, string> = {
  positive: styles.positive ?? "",
  warning: styles.warning ?? "",
  danger: styles.danger ?? "",
  info: styles.info ?? "",
  muted: styles.muted ?? "",
};

const HEARTBEAT_ORDER: Record<OverviewAgent["heartbeat"], number> = {
  ok: 0,
  timeout: 1,
  offline: 2,
  unknown: 3,
};

function statusText(agent: OverviewAgent): string {
  if (agent.heartbeat === "ok") {
    return agent.running ? "运行中" : "空闲";
  }
  return HEARTBEAT_LABEL[agent.heartbeat];
}

function stageText(value: string | null): string {
  if (value === null) {
    return "";
  }
  return TASK_STAGE_LABEL[value as keyof typeof TASK_STAGE_LABEL] ?? value;
}

function statusLabel(value: string | null): string {
  if (value === null) {
    return "";
  }
  return TASK_STATUS_LABEL[value as keyof typeof TASK_STATUS_LABEL] ?? value;
}

function sortAgents(agents: readonly OverviewAgent[]): OverviewAgent[] {
  return [...agents].sort((a, b) => {
    if (a.running !== b.running) {
      return a.running ? -1 : 1;
    }
    return HEARTBEAT_ORDER[a.heartbeat] - HEARTBEAT_ORDER[b.heartbeat];
  });
}

export function AgentCards({ agents, now, onManageKey }: AgentCardsProps) {
  return (
    <ul className={styles.grid} aria-label="Agent 卡片">
      {sortAgents(agents).map((agent) => {
        const tone = HEARTBEAT_TONE[agent.heartbeat];
        const taskMeta = [stageText(agent.currentTaskStage), statusLabel(agent.currentTaskStatus)]
          .filter((part) => part !== "")
          .join(" · ");
        return (
          <li key={agent.id} className={styles.card}>
            <div className={styles.cardTop}>
              <div className={styles.identity}>
                <span className={styles.name} title={agent.displayName}>
                  {agent.displayName}
                </span>
                <span className={styles.chip}>{agent.project}</span>
              </div>
              <span className={`${styles.status} ${TONE_CLASS[tone]}`}>
                <span className={styles.dot} aria-hidden="true" />
                {statusText(agent)}
              </span>
            </div>

            <div className={styles.meta}>
              <span>{agent.machineHostname}</span>
              <span>项目 · {agent.project}</span>
              <span title={agent.lastRunAt === null ? undefined : formatDateTime(agent.lastRunAt)}>
                {agent.lastRunAt === null ? "从未运行" : formatRelativeTime(agent.lastRunAt, now)}
              </span>
            </div>

            {agent.currentTaskId === null ? (
              // 未建单的运行会话用最近一条指令回答「在忙什么」,比一句「未关联任务」有用
              agent.running && agent.currentInstruction !== null ? (
                <div
                  className={`${styles.emptyTask} ${styles.instruction}`}
                  title={agent.currentInstruction}
                >
                  <span className={styles.instructionTag}>最近指令</span>
                  <span className={styles.instructionText}>· {agent.currentInstruction}</span>
                </div>
              ) : (
                <div className={styles.emptyTask}>
                  {agent.running ? "运行中 · 当前会话未关联任务" : "当前没有进行中的任务"}
                </div>
              )
            ) : (
              <div className={styles.taskStrip}>
                <span className={styles.taskId}>{agent.currentTaskId}</span>
                <span className={styles.taskTitle}>
                  {agent.currentTaskTitle ?? agent.currentTaskId}
                </span>
                {taskMeta === "" ? null : <span className={styles.taskMeta}> · {taskMeta}</span>}
              </div>
            )}

            <div className={styles.footer}>
              <span>
                今日{" "}
                <strong title={formatExactTokens(agent.todayTokens)}>
                  {formatTokens(agent.todayTokens)}
                </strong>{" "}
                tok
              </span>
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
            </div>
          </li>
        );
      })}
    </ul>
  );
}
