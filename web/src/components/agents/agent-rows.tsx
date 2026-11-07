import type { AgentRosterSummary } from "../../api/identity.js";
import type { OverviewAgent } from "../../api/types.js";
import { HEARTBEAT_LABEL, HEARTBEAT_TONE, TASK_STAGE_LABEL, TASK_STATUS_LABEL } from "../../shared/labels.js";
import { Badge } from "../ui/Badge.js";

/** 名册行与总览活体状态合并后的公共取数 */

/** 状态列三段编码：启停 + 心跳 + 运行态，颜色之外都带文字 */
export function statusBadges(agent: AgentRosterSummary, live: OverviewAgent | undefined) {
  const badges = [];
  if (agent.status === "disabled") {
    badges.push(<Badge key="disabled" tone="muted" text="已停用" />);
  } else {
    badges.push(<Badge key="enabled" tone="positive" text="启用" />);
  }
  if (agent.status === "active") {
    badges.push(
      <Badge
        key="heartbeat"
        tone={HEARTBEAT_TONE[live?.heartbeat ?? "unknown"]}
        text={HEARTBEAT_LABEL[live?.heartbeat ?? "unknown"]}
      />,
    );
    if (live?.running === true) {
      badges.push(<Badge key="running" tone="info" text="运行中" />);
    }
  }
  return badges;
}

/** 当前任务的阶段与状态,取不到时返回空串 */
export function taskMeta(live: OverviewAgent | undefined): string {
  if (live === undefined) {
    return "";
  }
  const stage = live.currentTaskStage;
  const status = live.currentTaskStatus;
  const parts = [];
  if (stage !== null && stage !== undefined) {
    parts.push(TASK_STAGE_LABEL[stage as keyof typeof TASK_STAGE_LABEL] ?? stage);
  }
  if (status !== null && status !== undefined) {
    parts.push(TASK_STATUS_LABEL[status as keyof typeof TASK_STATUS_LABEL] ?? status);
  }
  return parts.join(" · ");
}
