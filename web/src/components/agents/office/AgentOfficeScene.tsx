import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentRosterSummary } from "../../../api/identity.js";
import type { OverviewAgent } from "../../../api/types.js";
import { officeTransitionOf } from "./office-behavior.js";
import { OFFICE_STATE_LABEL, type OfficeState } from "./office-state.js";
import { OfficeOverlay } from "./OfficeOverlay.js";
import { StationSprite } from "./StationSprite.js";
import { buildScene, createStageMapper } from "./scene-layout.js";
import type { PixTransition } from "./pix/PixActor.js";
import { ROOM_H, ROOM_W } from "./pix/geometry.js";
import styles from "./office.module.css";

/** 「刚刚完成」这类时效文案的复查间隔 */
const NOW_TICK_MS = 10_000;

const OFFICE_STATES: OfficeState[] = ["running", "idle", "hold", "offline", "disabled"];

const DOT_CLASS: Record<OfficeState, string> = {
  running: styles.dotRunning ?? "",
  idle: styles.dotIdle ?? "",
  hold: styles.dotHold ?? "",
  offline: styles.dotOffline ?? "",
  disabled: styles.dotDisabled ?? "",
};

export interface AgentOfficeSceneProps {
  agents: readonly AgentRosterSummary[];
  liveById: ReadonlyMap<string, OverviewAgent>;
  /** 点工位打开机器人详情抽屉 */
  onOpenDetail: (agent: AgentRosterSummary) => void;
}

/** 办公室视图：Agent 变成像素房间里工位上的角色，按机器分区，状态即姿势 */
export function AgentOfficeScene({ agents, liveById, onOpenDetail }: AgentOfficeSceneProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  /** 时效文案（刚刚完成）与打盹判断都要看「现在」，定期走一格 */
  const [now, setNow] = useState(() => Date.now());
  /** 每个工位上一轮的状态，用来判断要不要播一次性过渡动作 */
  const prevStates = useRef(new Map<string, OfficeState>());
  const transitionSeq = useRef(0);
  const [transitions, setTransitions] = useState<Record<string, PixTransition>>({});

  useEffect(() => {
    const element = frameRef.current;
    if (element === null) return;
    const update = () => {
      const width = element.clientWidth;
      setScale(width > 0 ? Math.min(1, width / ROOM_W) : 1);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const scene = useMemo(() => buildScene(agents, liveById), [agents, liveById]);

  /**
   * 状态迁移 → 一次性过渡动作。
   *
   * 只在「待命 ↔ 工作」之间产生，其余进出只换循环动作。
   * 放在 layout effect 里是为了赶在浏览器绘制前把过渡层挂上，
   * 否则状态先变、动作后到，中间会闪一帧。
   */
  useLayoutEffect(() => {
    const previous = prevStates.current;
    const started: Record<string, PixTransition> = {};
    for (const station of scene.stations) {
      const before = previous.get(station.agent.id);
      const transition = officeTransitionOf(before, station.state);
      if (transition === null) continue;
      transitionSeq.current += 1;
      started[station.agent.id] = {
        clip: transition.clip,
        durationMs: transition.durationMs,
        seq: transitionSeq.current,
      };
    }
    prevStates.current = new Map(scene.stations.map((station) => [station.agent.id, station.state]));
    if (Object.keys(started).length > 0) {
      setTransitions((current) => ({ ...current, ...started }));
    }
  }, [scene]);

  const mapper = useMemo(
    () => createStageMapper({ scale, roomScale: scene.roomScale, origin: scene.origin }),
    [scale, scene.roomScale, scene.origin],
  );

  if (scene.stations.length === 0) {
    return null;
  }

  return (
    <div>
      <div className={styles.scene} role="group" aria-label="办公室视图" ref={frameRef}>
        <div className={styles.stage} style={{ width: ROOM_W * scale, height: ROOM_H * scale }}>
          <div
            className={styles.room}
            style={{ width: ROOM_W, height: ROOM_H, transform: `scale(${scale})` }}
          >
            <img className={styles.roomImage} src="/pix/room.webp" alt="" />
            <div
              className={styles.stations}
              style={{
                transform: `scale(${scene.roomScale})`,
                transformOrigin: `${scene.origin.x}px ${scene.origin.y}px`,
              }}
            >
              {scene.stations.map((station) => (
                <StationSprite
                  key={station.agent.id}
                  station={station}
                  transition={transitions[station.agent.id] ?? null}
                  now={now}
                />
              ))}
            </div>
          </div>

          <OfficeOverlay
            stations={scene.stations}
            zones={scene.zones}
            mapper={mapper}
            now={now}
            onOpenDetail={onOpenDetail}
          />
        </div>
      </div>

      <ul className={styles.legend} aria-label="状态图例">
        {OFFICE_STATES.map((state) => (
          <li key={state} className={styles.legendItem}>
            <span className={`${styles.legendDot} ${DOT_CLASS[state]}`} aria-hidden="true" />
            {OFFICE_STATE_LABEL[state]}
          </li>
        ))}
      </ul>
    </div>
  );
}
