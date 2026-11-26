import { officeSleepyOf } from "./office-behavior.js";
import type { StationScene } from "./scene-layout.js";
import { PixActor, type PixTransition } from "./pix/PixActor.js";
import {
  CHAIR_H,
  CHAIR_W,
  DESK_H,
  DESK_W,
  PROPS,
  SHADOW,
  STATION,
  WALK_DISTANCE,
} from "./pix/geometry.js";

export interface StationSpriteProps {
  station: StationScene;
  /** 一次性过渡动作，没有则为空 */
  transition: PixTransition | null;
  /** 「刚忙完不犯困」的判断时刻 */
  now: number;
}

/** 工位：桌子、桌面小物、椅子与角色 */
export function StationSprite({ station, transition, now }: StationSpriteProps) {
  const { slot } = station;
  const dimmed = station.state === "offline" || station.state === "disabled";
  const sleepy = officeSleepyOf(station.state, station.live, now);
  const prop = station.prop === null ? null : PROPS[station.prop];
  return (
    <div
      className="absolute top-0 left-0 origin-top-left"
      style={{
        transform: `translate3d(${slot.x}px, ${slot.y - DESK_H}px, 0) scale(${slot.scale})`,
      }}
    >
      <span
        className="absolute rounded-full pointer-events-none [background:radial-gradient(ellipse_at_center,rgb(96_82_64/32%),rgb(96_82_64/0%)_72%)]"
        style={{
          left: SHADOW.x - SHADOW.w / 2,
          top: SHADOW.y,
          width: SHADOW.w,
          height: SHADOW.h,
        }}
      />
      <img
        className="absolute block drop-shadow-[0_3px_3px_rgb(88_74_58/28%)]"
        src="/pix/desk.webp"
        width={DESK_W}
        height={DESK_H}
        style={{ width: DESK_W, height: DESK_H }}
        alt=""
      />
      {/* 小物摆在桌面上，压在角色之前（角色站在桌前，会挡住桌面） */}
      {prop === null ? null : (
        <img
          className="absolute block [image-rendering:pixelated] pointer-events-none"
          src={`/pix/props/${station.prop}.webp`}
          width={prop.w}
          height={prop.h}
          style={{ left: prop.x, top: prop.y, width: prop.w, height: prop.h }}
          alt=""
        />
      )}
      <PixActor
        pack={station.pack}
        clip={station.clip}
        feet={STATION.feet}
        walkFrom={{
          x: STATION.feet.x - WALK_DISTANCE / slot.scale,
          y: STATION.feet.y,
        }}
        walkMs={station.walkMs}
        delay={station.delay}
        dimmed={dimmed}
        sway={station.state === "hold"}
        breathe={station.state === "idle"}
        transition={transition}
      />
      {/* 椅子画在角色之前（更靠近观众），遮住角色下半身 */}
      <img
        className="absolute block [filter:drop-shadow(0_2px_3px_rgb(88_74_58/30%))_drop-shadow(0_0_1px_rgb(120_105_85/40%))]"
        src="/pix/chair.webp"
        width={CHAIR_W}
        height={CHAIR_H}
        style={{ left: STATION.chair.x, top: STATION.chair.y, width: CHAIR_W, height: CHAIR_H }}
        alt=""
      />
      {sleepy ? (
        <span className="absolute text-muted text-xs leading-none pointer-events-none animate-[office-zzz_2.8s_ease-in-out_infinite] motion-reduce:animate-none motion-reduce:opacity-0" aria-hidden="true" style={{ left: STATION.feet.x + 40, top: -78 }}>
          Z
        </span>
      ) : null}
    </div>
  );
}
