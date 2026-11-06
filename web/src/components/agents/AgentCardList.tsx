import type { AgentRosterSummary } from "../../api/identity.js";
import type { OverviewAgent } from "../../api/types.js";
import { formatRelativeTime, formatTokens } from "../../shared/format.js";
import { NOT_COLLECTED, RUNTIME_LABEL } from "../../shared/labels.js";
import { agentDisplayName, hasCollector } from "../../shared/agent-label.js";
import { Button } from "../ui/Button.js";
import { statusBadges, taskMeta } from "./agent-rows.js";
import styles from "./agents.module.css";

export interface AgentCardListProps {
  agents: readonly AgentRosterSummary[];
  liveById: ReadonlyMap<string, OverviewAgent>;
  onEdit: (agent: AgentRosterSummary) => void;
  onRotateKey: (agent: AgentRosterSummary) => void;
}

/** 窄屏卡片列表：表格转卡片，触达区不小于按钮默认尺寸 */
export function AgentCardList({
  agents,
  liveById,
  onEdit,
  onRotateKey,
}: AgentCardListProps) {
  return (
    <ul className={styles.cardList} aria-label="Agent 卡片">
      {agents.map((agent) => {
        const live = liveById.get(agent.id);
        const title = live?.currentTaskTitle ?? null;
        const instruction = title === null && live?.running === true ? live.currentInstruction : null;
        return (
          <li key={agent.id} className={styles.card}>
            <div className={styles.cardTop}>
              <div className={styles.identity}>
                <span className={styles.identityName}>{agentDisplayName(agent)}</span>
                <span className={styles.identitySub}>
                  {agent.project} · {RUNTIME_LABEL[agent.runtime]}
                </span>
              </div>
              <div className={styles.statusCell}>{statusBadges(agent, live)}</div>
            </div>
            {title === null ? (
              instruction === null ? (
                <p className={styles.muted}>
                  {live?.running === true ? "运行中 · 当前会话未关联任务" : "当前没有进行中的任务"}
                </p>
              ) : (
                <p className={styles.cardInstruction} title={instruction}>
                  <span className={styles.instructionTag}>最近指令</span>
                  {instruction}
                </p>
              )
            ) : (
              <p className={styles.cardInstruction} title={title}>
                {title}
                {taskMeta(live) === "" ? "" : ` · ${taskMeta(live)}`}
              </p>
            )}
            <div className={styles.cardMeta}>
              {!hasCollector(agent) ? (
                <span>{NOT_COLLECTED}</span>
              ) : (
                <>
                  <span>累计运行 {agent.totalRuns} 次</span>
                  <span>累计 {formatTokens(agent.totalTokens)} tok</span>
                  <span>
                    最近运行{" "}
                    {agent.lastRunAt === null ? "从未运行" : formatRelativeTime(agent.lastRunAt)}
                  </span>
                </>
              )}
            </div>
            <div className={styles.rowActionsLeft}>
              <Button size="sm" variant="secondary" onClick={() => onEdit(agent)}>
                管理
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onRotateKey(agent)}>
                密钥
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
