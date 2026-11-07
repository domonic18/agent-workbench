import { Monitor } from "lucide-react";
import type { AgentRosterSummary } from "../../api/identity.js";
import type { OverviewAgent } from "../../api/types.js";
import { formatRelativeTime, formatTokens } from "../../shared/format.js";
import { NOT_COLLECTED, RUNTIME_LABEL } from "../../shared/labels.js";
import { agentDisplayName, hasCollector } from "../../shared/agent-label.js";
import { RuntimeIcon } from "../../shared/runtime-icon.js";
import { Button } from "../ui/Button.js";
import { Tooltip } from "../ui/Tooltip.js";
import { statusBadges, taskMeta } from "./agent-rows.js";
import styles from "./agents.module.css";

export interface AgentCardListProps {
  agents: readonly AgentRosterSummary[];
  liveById: ReadonlyMap<string, OverviewAgent>;
  /** 点机器人名打开详情抽屉 */
  onOpenDetail: (agent: AgentRosterSummary) => void;
  onEdit: (agent: AgentRosterSummary) => void;
  onRotateKey: (agent: AgentRosterSummary) => void;
}

/** 卡片列表：窄屏默认形态，也可由用户切换 */
export function AgentCardList({
  agents,
  liveById,
  onOpenDetail,
  onEdit,
  onRotateKey,
}: AgentCardListProps) {
  return (
    <ul className={styles.cardList} aria-label="机器人卡片">
      {agents.map((agent) => {
        const live = liveById.get(agent.id);
        const title = live?.currentTaskTitle ?? null;
        const instruction = title === null && live?.running === true ? live.currentInstruction : null;
        const machineName = agent.machineDisplayName ?? agent.machineHostname;
        return (
          <li key={agent.id} className={styles.card}>
            <div className={styles.cardTop}>
              <div className={styles.identity}>
                <button
                  type="button"
                  className={`${styles.identityName} ${styles.nameButton}`}
                  onClick={() => onOpenDetail(agent)}
                >
                  {agentDisplayName(agent)}
                </button>
                <span className={styles.identitySub}>
                  {agent.project}
                  <Tooltip label={`运行时：${RUNTIME_LABEL[agent.runtime]}`}>
                    <RuntimeIcon runtime={agent.runtime} size={12} />
                  </Tooltip>
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
              <span className={styles.machineCell}>
                <Monitor size={12} aria-hidden="true" />
                {machineName ?? "未绑定"}
              </span>
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
