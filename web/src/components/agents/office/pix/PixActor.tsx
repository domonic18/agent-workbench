import type { CSSProperties } from "react";
import "../../../../assets/pix/frames.css";
import {
  PIX_CLIP_CLASS,
  PIX_CLIP_DURATION,
  PIX_CLIP_FOOT_Y,
  PIX_CLIP_PIVOT_X,
} from "../../../../assets/pix/manifest.js";
import { WALK_CLIP } from "./clip-map.js";
import styles from "../office.module.css";

/** 状态姿势淡入时长 */
const FADE_MS = 320;

/** 素材帧表的精灵类名（全局样式，见 assets/pix/frames.css） */
const SPRITE_CLASS = "pix-sprite";

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
 * 两层精灵叠加：走位层播放走路动作，入场结束后淡出；
 * 状态层循环播放当前状态的动作并接管画面。
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
}: PixActorProps) {
  const walkKeyframe = PIX_CLIP_CLASS[WALK_CLIP] ?? "";
  const stateKeyframe = PIX_CLIP_CLASS[clip] ?? "";
  const walkCycle = PIX_CLIP_DURATION[WALK_CLIP] ?? 800;
  const walkFoot = PIX_CLIP_FOOT_Y[WALK_CLIP] ?? 0;
  const stateFoot = PIX_CLIP_FOOT_Y[clip] ?? 0;
  const walkPivot = PIX_CLIP_PIVOT_X[WALK_CLIP] ?? 0;
  const statePivot = PIX_CLIP_PIVOT_X[clip] ?? 0;
  const cycles = Math.max(1, Math.round(walkMs / walkCycle));

  return (
    <div
      className={`${styles.actor} ${dimmed ? styles.dimmed : ""}`}
      style={cssVars({
        "--from-x": `${walkFrom.x}px`,
        "--from-y": `${walkFrom.y}px`,
        "--to-x": `${feet.x}px`,
        "--to-y": `${feet.y}px`,
        "--walk-ms": `${walkMs}ms`,
        "--delay": `${delay}ms`,
        "--fade-ms": `${FADE_MS}ms`,
        "--state-delay": `${delay + walkMs}ms`,
      })}
    >
      <div className={styles.walkFade}>
        <div
          className={`${SPRITE_CLASS} ${walkKeyframe} ${styles.spriteBox}`}
          style={{
            backgroundImage: sheetOf(pack),
            transform: `translate(${-walkPivot}px, ${-walkFoot}px)`,
            animation: `${walkKeyframe} ${walkCycle}ms steps(1, end) ${cycles} ${delay}ms`,
          }}
        />
      </div>
      <div className={styles.stateFade}>
        <div className={`${styles.pose} ${sway ? styles.sway : ""}`}>
          <div
            className={`${SPRITE_CLASS} ${stateKeyframe} ${styles.spriteBox}`}
            style={{
              backgroundImage: sheetOf(pack),
              transform: `translate(${-statePivot}px, ${-stateFoot}px)`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
