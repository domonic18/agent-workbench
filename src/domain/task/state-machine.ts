import type { TaskStage, TaskStatus } from "../../shared/constants.js";

export class InvalidTransitionError extends Error {
  constructor(
    readonly dimension: "status" | "stage",
    readonly from: string,
    readonly to: string,
  ) {
    super(`非法${dimension === "status" ? "状态" : "阶段"}跃迁: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

/** 终态:done / cancelled 无出口,重开必须新建任务,避免历史被改写 */
const STATUS_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["running", "cancelled"],
  running: ["blocked", "review", "done", "cancelled"],
  blocked: ["running", "cancelled"],
  review: ["running", "done", "cancelled"],
  done: [],
  cancelled: [],
};

/** review → exec 是打回返工;其余阶段只向前 */
const STAGE_TRANSITIONS: Record<TaskStage, readonly TaskStage[]> = {
  intake: ["plan", "closed"],
  plan: ["exec", "closed"],
  exec: ["review", "closed"],
  review: ["exec", "deliver"],
  deliver: ["closed"],
  closed: [],
};

export function canTransitionStatus(from: TaskStatus, to: TaskStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export function canTransitionStage(from: TaskStage, to: TaskStage): boolean {
  return STAGE_TRANSITIONS[from].includes(to);
}

export function assertStatusTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionStatus(from, to)) {
    throw new InvalidTransitionError("status", from, to);
  }
}

export function assertStageTransition(from: TaskStage, to: TaskStage): void {
  if (!canTransitionStage(from, to)) {
    throw new InvalidTransitionError("stage", from, to);
  }
}

/**
 * 打回:review 退回 running 时 rework_count + 1 并写 rework 事件(02 §3.1)。
 * `round` 是 A2A 往返轮次,与 `rework_count` 各记各的,不得互相替代。
 */
export function isRework(from: TaskStatus, to: TaskStatus): boolean {
  return from === "review" && to === "running";
}

export function nextReworkCount(current: number, from: TaskStatus, to: TaskStatus): number {
  return isRework(from, to) ? current + 1 : current;
}
