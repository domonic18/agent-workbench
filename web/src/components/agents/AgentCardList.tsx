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
    <ul className="flex flex-col gap-3 p-4" aria-label="机器人卡片">
      {agents.map((agent) => {
        const live = liveById.get(agent.id);
        const title = live?.currentTaskTitle ?? null;
        const instruction = title === null && live?.running === true ? live.currentInstruction : null;
        const machineName = agent.machineDisplayName ?? agent.machineHostname;
        return (
          <li key={agent.id} className="p-4 border border-border rounded-md bg-surface-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-px min-w-0">
                <button
                  type="button"
                  className="font-semibold text-foreground [overflow-wrap:normal] [word-break:normal] p-0 border-0 bg-transparent text-inherit text-left cursor-pointer enabled:hover:text-accent"
                  onClick={() => onOpenDetail(agent)}
                >
                  {agentDisplayName(agent)}
                </button>
                <span className="text-xs text-muted overflow-hidden text-ellipsis whitespace-nowrap">
                  {agent.project}
                  <Tooltip label={`运行时：${RUNTIME_LABEL[agent.runtime]}`}>
                    <RuntimeIcon runtime={agent.runtime} size={12} />
                  </Tooltip>
                </span>
              </div>
              <div className="flex flex-wrap gap-1 items-center">{statusBadges(agent, live)}</div>
            </div>
            {title === null ? (
              instruction === null ? (
                <p className="text-muted">
                  {live?.running === true ? "运行中 · 当前会话未关联任务" : "当前没有进行中的任务"}
                </p>
              ) : (
                <p className="mt-3 text-sm text-foreground [overflow-wrap:anywhere] line-clamp-3 overflow-hidden" title={instruction}>
                  <span className="mr-1 font-semibold text-muted">最近指令</span>
                  {instruction}
                </p>
              )
            ) : (
              <p className="mt-3 text-sm text-foreground [overflow-wrap:anywhere] line-clamp-3 overflow-hidden" title={title}>
                {title}
                {taskMeta(live) === "" ? "" : ` · ${taskMeta(live)}`}
              </p>
            )}
            <div className="flex flex-wrap gap-2 mt-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1 max-w-full text-text-secondary">
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
            <div className="flex flex-wrap gap-2 items-center">
              <Button
                size="sm"
                variant="secondary"
                className="max-md:h-touch max-md:px-4 max-md:py-0"
                onClick={() => onEdit(agent)}
              >
                管理
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="max-md:h-touch max-md:px-4 max-md:py-0"
                onClick={() => onRotateKey(agent)}
              >
                密钥
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
