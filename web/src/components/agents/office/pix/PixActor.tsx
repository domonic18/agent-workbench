import type { CSSProperties } from "react";
import "../../../../assets/pix/frames.css";
import {
  PIX_CLIP_CLASS,
  PIX_CLIP_DURATION,
  PIX_CLIP_FOOT_Y,
  PIX_CLIP_PIVOT_X,
} from "../../../../assets/pix/manifest.js";
import { WALK_CLIP } from "./clip-map.js";
import { cn } from "../../../../lib/utils.js";
/** 状态姿势淡入时长 */
const FADE_MS = 320;

/** 素材帧表的精灵类名（全局样式，见 assets/pix/frames.css） */
const SPRITE_CLASS = "pix-sprite";

export interface PixTransition {
  /** 一次性动作片段 */
  clip: string;
  /** 动作时长（毫秒） */
  durationMs: number;
  /**
   * 每次过渡自增。
   *
   * 用作 React key 的一部分：同一段动作连播两次时必须重挂载元素，
   * 否则 CSS 动画不会重新开始，角色会卡在末帧。
   */
  seq: number;
}

export interface PixActorProps {
  /** 角色素材包 */
  pack: string;
  /** 状态对应的动作片段 */
  clip: string;
  /** 脚底在工位局部坐标里的位置 */
  feet: { x: number; y: number };
  /** 走位起点（工位局部坐标） */
  walkFrom: { x: number; y: number };
  /** 走位时长（毫秒） */
  walkMs: number;
  /** 入场延迟（毫秒），错峰入场 */
  delay: number;
  /** 离线/停用：灰度压暗 */
  dimmed?: boolean;
  /** 派发挂起：轻微摇晃 */
  sway?: boolean;
  /** 待命：轻微呼吸 */
  breathe?: boolean;
  /** 一次性过渡动作，没有则为空 */
  transition?: PixTransition | null;
}

function cssVars(vars: Record<string, string>): CSSProperties {
  return vars as CSSProperties;
}

function sheetOf(pack: string): string {
  return `url(/pix/characters/${pack}.webp)`;
}

/**
 * 工位上的像素角色。
 *
 * 三层精灵叠加：走位层播放走路动作，入场结束后淡出；
 * 状态层循环播放当前状态的动作并接管画面；
 * 过渡层是一次性动作（落座/起身），播完淡出，把画面交回状态层。
 *
 * 帧表是全局样式而非 CSS module——module 会改写类名与 @keyframes 名字，
 * 而这里要按 clip 名同时引用两者。
 */
export function PixActor({
  pack,
  clip,
  feet,
  walkFrom,
  walkMs,
  delay,
  dimmed = false,
  sway = false,
  breathe = false,
  transition = null,
}: PixActorProps) {
  const walkKeyframe = PIX_CLIP_CLASS[WALK_CLIP] ?? "";
  const stateKeyframe = PIX_CLIP_CLASS[clip] ?? "";
  const walkCycle = PIX_CLIP_DURATION[WALK_CLIP] ?? 800;
  const walkFoot = PIX_CLIP_FOOT_Y[WALK_CLIP] ?? 0;
  const stateFoot = PIX_CLIP_FOOT_Y[clip] ?? 0;
  const walkPivot = PIX_CLIP_PIVOT_X[WALK_CLIP] ?? 0;
  const statePivot = PIX_CLIP_PIVOT_X[clip] ?? 0;
  const cycles = Math.max(1, Math.round(walkMs / walkCycle));

  const transKeyframe = transition === null ? "" : PIX_CLIP_CLASS[transition.clip] ?? "";
  const transFoot = transition === null ? 0 : PIX_CLIP_FOOT_Y[transition.clip] ?? 0;
  const transPivot = transition === null ? 0 : PIX_CLIP_PIVOT_X[transition.clip] ?? 0;

  // 有过渡时状态层改用「先隐后现」的时序，与过渡层交叉淡化；
  // 状态层的 key 跟着过渡序号走，保证每次过渡都重放一次时序。
  const stateClass =
    transition === null
      ? "absolute top-0 left-0 opacity-0 [animation:office-state-fade_var(--fade-ms)_linear_var(--state-delay)_forwards] motion-reduce:!animate-none motion-reduce:!opacity-100"
      : "absolute top-0 left-0 opacity-0 [animation:office-state-trans_var(--trans-ms)_linear_forwards] motion-reduce:!animate-none motion-reduce:!opacity-100";

  return (
    <div
      className={cn(
        "absolute top-0 left-0 [transform:translate3d(var(--to-x),var(--to-y),0)] [animation:office-walk-in_var(--walk-ms)_ease-in-out_var(--delay)_both] motion-reduce:animate-none",
        dimmed && "grayscale opacity-45",
      )}
      style={cssVars({
        "--from-x": `${walkFrom.x}px`,
        "--from-y": `${walkFrom.y}px`,
        "--to-x": `${feet.x}px`,
        "--to-y": `${feet.y}px`,
        "--walk-ms": `${walkMs}ms`,
        "--delay": `${delay}ms`,
        "--fade-ms": `${FADE_MS}ms`,
        "--state-delay": `${delay + walkMs}ms`,
        "--trans-ms": `${transition?.durationMs ?? 0}ms`,
      })}
    >
      <div className="absolute top-0 left-0 [animation:office-walk-fade_var(--walk-ms)_linear_var(--delay)_forwards] motion-reduce:!animate-none motion-reduce:!opacity-0">
        <div
          className={`${SPRITE_CLASS} ${walkKeyframe} absolute top-0 left-0`}
          style={{
            backgroundImage: sheetOf(pack),
            transform: `translate(${-walkPivot}px, ${-walkFoot}px)`,
            animation: `${walkKeyframe} ${walkCycle}ms steps(1, end) ${cycles} ${delay}ms`,
          }}
        />
      </div>
      <div key={`state-${transition?.seq ?? 0}`} className={stateClass}>
        <div
          className={cn(
            "absolute top-0 left-0",
            sway && "animate-[office-sway_1.8s_ease-in-out_infinite_alternate] motion-reduce:animate-none",
            breathe && "animate-[office-breathe_3.4s_ease-in-out_infinite_alternate] motion-reduce:animate-none",
          )}
        >
          <div
            className={`${SPRITE_CLASS} ${stateKeyframe} absolute top-0 left-0`}
            style={{
              backgroundImage: sheetOf(pack),
              transform: `translate(${-statePivot}px, ${-stateFoot}px)`,
            }}
          />
        </div>
      </div>
      {transition !== null ? (
        <div
          key={`trans-${transition.seq}`}
          className="absolute top-0 left-0 [animation:office-trans-fade_var(--trans-ms)_linear_forwards] motion-reduce:!animate-none motion-reduce:!opacity-0"
        >
          <div
            className={`${SPRITE_CLASS} ${transKeyframe} absolute top-0 left-0`}
            style={{
              backgroundImage: sheetOf(pack),
              transform: `translate(${-transPivot}px, ${-transFoot}px)`,
              animation: `${transKeyframe} ${transition.durationMs}ms steps(1, end) 1 both`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
