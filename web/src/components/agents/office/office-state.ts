import type { AgentRosterSummary } from "../../../api/identity.js";
import type { OverviewAgent } from "../../../api/types.js";

/** 办公室视图的状态抽象：由名册启停与总览活体状态投影，供场景摆姿与文案共用 */
export type OfficeState = "running" | "idle" | "hold" | "offline" | "disabled";

export const OFFICE_STATE_LABEL: Record<OfficeState, string> = {
  running: "工作中",
  idle: "待命",
  hold: "派发挂起",
  offline: "离线",
  disabled: "已停用",
};

/** 优先级：停用 > 心跳丢失 > 派发挂起 > 运行中 > 待命 */
export function officeStateOf(
  agent: AgentRosterSummary,
  live: OverviewAgent | undefined,
): OfficeState {
  if (agent.status === "disabled") {
    return "disabled";
  }
  if (live !== undefined && (live.heartbeat === "timeout" || live.heartbeat === "offline")) {
    return "offline";
  }
  if (live !== undefined && live.dispatchHold !== null) {
    return "hold";
  }
  if (live?.running === true) {
    return "running";
  }
  return "idle";
}
