import type { OverviewAgent } from "../../../api/types.js";
import {
  DISPATCH_HOLD_LABEL,
  DISPATCH_HOLD_TONE,
  OFFICE_BUBBLE_LABEL,
  TASK_STAGE_LABEL,
} from "../../../shared/labels.js";
import type { Tone } from "../../../shared/tone.js";
import { PIX_CLIP_DURATION } from "../../../assets/pix/manifest.js";
import { STATE_CLIP } from "./pix/clip-map.js";
import type { OfficeState } from "./office-state.js";

/**
 * 办公室视图的行为状态机。
 *
 * 纯函数：状态与活体数据进，姿势/过渡/气泡出，不引 React，
 * 便于把「什么时候该动」的口径单独测。
 */

/** 头顶气泡 */
export interface OfficeBubble {
  text: string;
  tone: Tone;
}

/** 一次性过渡动作 */
export interface OfficeTransition {
  clip: string;
  durationMs: number;
}

/** 一个工位当前该表现出什么 */
export interface OfficeBehavior {
  /** 持续循环的动作 */
  clip: string;
  /** 一次性过渡动作，没有则为 null */
  transition: OfficeTransition | null;
  /** 头顶气泡，没有则不占位 */
  bubble: OfficeBubble | null;
}

/** 刚跑完多久之内算「刚刚完成」 */
const JUST_DONE_MS = 90_000;

/** 气泡里展示的指令长度上限：再长也只占一格 */
const INSTRUCTION_MAX = 10;

function transition(clip: string): OfficeTransition {
  return { clip, durationMs: PIX_CLIP_DURATION[clip] ?? 0 };
}

/**
 * 状态 → 持续动作。
 *
 * 跑起来了就是坐在桌前干活：有明确指令时用打字动作，
 * 没指令时用安静工作（上游的 13 步时间轴，含细微起伏）。
 */
export function officeClipOf(state: OfficeState, live: OverviewAgent | undefined): string {
  if (state === "running") {
    const instruction = live?.currentInstruction ?? null;
    return instruction !== null ? "work.typing-back" : "work.quiet-back";
  }
  return STATE_CLIP[state];
}

/**
 * 状态迁移 → 一次性过渡动作。
 *
 * 只在「待命 ↔ 工作」这条轴上产生：其余进出（挂起、离线、停用）
 * 只是换个姿势，不需要起落动作。
 */
export function officeTransitionOf(
  prev: OfficeState | undefined,
  next: OfficeState,
): OfficeTransition | null {
  if (prev === undefined) {
    // 首帧没有「上一状态」，不产过渡
    return null;
  }
  if (prev === "idle" && next === "running") {
    return transition("sit-down.back");
  }
  if (prev === "running" && next === "idle") {
    return transition("stand-up.back");
  }
  return null;
}

/** 工作中的一句话：有阶段说阶段，有指令说指令，都没有就说在执行 */
function runningText(live: OverviewAgent | undefined): string {
  const stage = live?.currentTaskStage ?? null;
  if (stage !== null) {
    return TASK_STAGE_LABEL[stage as keyof typeof TASK_STAGE_LABEL] ?? stage;
  }
  const instruction = live?.currentInstruction ?? null;
  if (instruction !== null) {
    return instruction.length > INSTRUCTION_MAX
      ? `${instruction.slice(0, INSTRUCTION_MAX)}…`
      : instruction;
  }
  return OFFICE_BUBBLE_LABEL.running;
}

/**
 * 头顶气泡。
 *
 * 只有「执行中 / 派发挂起 / 刚刚完成」占位——待命、离线、停用
 * 由名牌与灰度承载，再加气泡只会让画面更挤。
 */
export function officeBubbleOf(
  state: OfficeState,
  live: OverviewAgent | undefined,
  now: number = Date.now(),
): OfficeBubble | null {
  if (state === "running") {
    return { text: runningText(live), tone: "info" };
  }
  const hold = live?.dispatchHold ?? null;
  if (state === "hold" && hold !== null) {
    return { text: DISPATCH_HOLD_LABEL[hold], tone: DISPATCH_HOLD_TONE[hold] };
  }
  const endedAt = live?.lastRunEndedAt ?? null;
  if (state === "idle" && endedAt !== null && now - endedAt < JUST_DONE_MS) {
    return { text: OFFICE_BUBBLE_LABEL.justDone, tone: "positive" };
  }
  return null;
}

/**
 * 离线久到可以打哈欠。
 *
 * 刚跑完的 Agent 不打——刚忙完就犯困会读成「已挂」。
 */
export function officeSleepyOf(
  state: OfficeState,
  live: OverviewAgent | undefined,
  now: number = Date.now(),
): boolean {
  if (state !== "offline" && state !== "disabled") {
    return false;
  }
  const endedAt = live?.lastRunEndedAt ?? null;
  return endedAt === null || now - endedAt > JUST_DONE_MS;
}
