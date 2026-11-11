import type { DispatchHoldReason } from "../../src/shared/constants.js";

/** 心跳捎带的单项目派发状态(wire 形态,snake_case) */
export interface DispatchStatusEntry {
  project: string;
  pending: number;
  hold: DispatchHoldReason;
  since_ts: number;
}

/**
 * 派发状态登记(M3.12):dispatch cycle 写入、heartbeat cycle 快照捎带。
 * 只登记被挡的项目——「有活派不出去必须上报可见」;挂起解除即清除,
 * 空快照在心跳里省略字段,旧版控制台与旧采集器互相兼容。
 */
export class DispatchStatusTracker {
  private byProject = new Map<
    string,
    { pending: number; hold: DispatchHoldReason; sinceTs: number }
  >();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** 记录挂起:同一原因持续不重置计时(时长即从首次挂起算),原因变化视为新一次挂起 */
  recordHold(project: string, hold: DispatchHoldReason, pending = 0): void {
    const prev = this.byProject.get(project);
    this.byProject.set(project, {
      pending,
      hold,
      sinceTs: prev !== undefined && prev.hold === hold ? prev.sinceTs : this.now(),
    });
  }

  /** 挂起解除:放行起会话或收件箱清空,控制台徽标随之消失 */
  clear(project: string): void {
    this.byProject.delete(project);
  }

  snapshot(): DispatchStatusEntry[] {
    return [...this.byProject.entries()]
      .map(([project, entry]) => ({
        project,
        pending: entry.pending,
        hold: entry.hold,
        since_ts: entry.sinceTs,
      }))
      .sort((a, b) => a.project.localeCompare(b.project));
  }
}
