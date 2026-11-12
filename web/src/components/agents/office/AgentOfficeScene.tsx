import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentRosterSummary } from "../../../api/identity.js";
import type { OverviewAgent } from "../../../api/types.js";
import { agentDisplayName } from "../../../shared/agent-label.js";
import { formatTokens } from "../../../shared/format.js";
import { RuntimeIcon } from "../../../shared/runtime-icon.js";
import { OFFICE_STATE_LABEL, officeStateOf, type OfficeState } from "./office-state.js";
import { PixActor } from "./pix/PixActor.js";
import { packOf, STATE_CLIP } from "./pix/clip-map.js";
import {
  CHAIR_H,
  CHAIR_W,
  DESK_H,
  DESK_W,
  ROOM_H,
  ROOM_W,
  SHADOW,
  STATION,
  WALK_DISTANCE,
  layoutGroups,
  type StationSlot,
} from "./pix/geometry.js";
import styles from "./office.module.css";

/** 走位速度（房间像素/秒），用来换算走位时长 */
const WALK_SPEED = 300;
/** 入场错峰间隔 */
const WALK_STAGGER = 120;

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

interface StationScene {
  agent: AgentRosterSummary;
  live: OverviewAgent | undefined;
  state: OfficeState;
  slot: StationSlot;
  pack: string;
  clip: string;
  walkMs: number;
  delay: number;
}

interface ZoneView {
  key: string;
  label: string;
  count: number;
  first: StationScene;
}

function busyText(live: OverviewAgent | undefined): string {
  const title = live?.currentTaskTitle ?? null;
  if (title !== null) {
    return title;
  }
  if (live?.running === true) {
    return live.currentInstruction ?? "运行中";
  }
  return "无进行中任务";
}

/** 办公室视图：Agent 变成像素房间里工位上的角色，按机器分区，状态即姿势 */
export function AgentOfficeScene({ agents, liveById, onOpenDetail }: AgentOfficeSceneProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

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

  const { stations, zones, origin, roomScale } = useMemo(() => {
    const groups = new Map<string, { label: string; members: AgentRosterSummary[] }>();
    for (const agent of agents) {
      const key = agent.machineId ?? "none";
      let group = groups.get(key);
      if (group === undefined) {
        group = {
          label: agent.machineDisplayName ?? agent.machineHostname ?? "未绑定机器",
          members: [],
        };
        groups.set(key, group);
      }
      group.members.push(agent);
    }

    const groupEntries = [...groups.entries()];
    const groupList = groupEntries.map(([, group]) => group);
    const layout = layoutGroups(groupList.map((group) => group.members.length));
    const walkMs = Math.round((WALK_DISTANCE / WALK_SPEED) * 1000);

    const taken = new Array<number>(groupList.length).fill(0);
    const frontOfGroup = new Map<number, StationScene>();
    const views: StationScene[] = [];
    for (const item of layout.placed) {
      const group = groupList[item.group];
      if (group === undefined) continue;
      const used = taken[item.group] ?? 0;
      const agent = group.members[used];
      if (agent === undefined) continue;
      taken[item.group] = used + 1;
      const live = liveById.get(agent.id);
      const state = officeStateOf(agent, live);
      const view: StationScene = {
        agent,
        live,
        state,
        slot: item.slot,
        pack: packOf(agent.id),
        clip: STATE_CLIP[state],
        walkMs,
        delay: views.length * WALK_STAGGER,
      };
      views.push(view);
      // 分区标签取组内最前排的那份：跨行时前排的标签更好认
      frontOfGroup.set(item.group, view);
    }

    const zoneViews: ZoneView[] = [];
    groupList.forEach((group, index) => {
      const first = frontOfGroup.get(index);
      if (first === undefined) return;
      zoneViews.push({
        key: groupEntries[index]?.[0] ?? `${index}`,
        label: group.label,
        count: group.members.length,
        first,
      });
    });

    return {
      stations: views,
      zones: zoneViews,
      origin: layout.origin,
      roomScale: layout.scale,
    };
  }, [agents, liveById]);

  if (stations.length === 0) {
    return null;
  }

  const stageWidth = ROOM_W * scale;
  const stageHeight = ROOM_H * scale;

  /**
   * 工位局部坐标 → 舞台坐标。
   *
   * 两层变换必须完全一致：工位层先按 slot.scale 摆位，再按房间容量整体缩放，
   * 命中层照抄同样的换算，名牌才不会跟角色错位。
   */
  const toStage = (slot: StationSlot, localX: number, localY: number) => {
    const roomX = slot.x + localX * slot.scale;
    const roomY = slot.y - DESK_H + localY * slot.scale;
    const layerX = origin.x + (roomX - origin.x) * roomScale;
    const layerY = origin.y + (roomY - origin.y) * roomScale;
    return { left: layerX * scale, top: layerY * scale };
  };

  return (
    <div>
      <div className={styles.scene} role="group" aria-label="办公室视图" ref={frameRef}>
        <div className={styles.stage} style={{ width: stageWidth, height: stageHeight }}>
          <div
            className={styles.room}
            style={{ width: ROOM_W, height: ROOM_H, transform: `scale(${scale})` }}
          >
            <img className={styles.roomImage} src="/pix/room.webp" alt="" />
            <div
              className={styles.stations}
              style={{
                transform: `scale(${roomScale})`,
                transformOrigin: `${origin.x}px ${origin.y}px`,
              }}
            >
              {stations.map((station) => (
                <StationSprite key={station.agent.id} station={station} />
              ))}
            </div>
          </div>

          <div className={styles.hits}>
            {zones.map((zone) => (
              <span
                key={zone.key}
                className={styles.zoneTag}
                style={toStage(zone.first.slot, STATION.zone.x, STATION.zone.y)}
              >
                {zone.label} · {zone.count} 个工位
              </span>
            ))}
            {stations.map((station) => {
              const name = agentDisplayName(station.agent);
              const busy = busyText(station.live);
              const tokens = station.live?.todayTokens ?? 0;
              return (
                <span key={station.agent.id}>
                  {tokens > 0 ? (
                    <span
                      className={styles.tokenBadge}
                      style={toStage(station.slot, STATION.badge.x, STATION.badge.y)}
                    >
                      今日 {formatTokens(tokens)} tok
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={styles.hit}
                    style={toStage(station.slot, STATION.label.x, STATION.label.y)}
                    aria-label={`${name}，${OFFICE_STATE_LABEL[station.state]}，${busy}`}
                    title={`${name} · ${OFFICE_STATE_LABEL[station.state]} · ${busy}`}
                    onClick={() => onOpenDetail(station.agent)}
                  >
                    <RuntimeIcon runtime={station.agent.runtime} size={12} />
                    <span className={styles.hitName}>{name}</span>
                  </button>
                </span>
              );
            })}
          </div>
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

/** 工位：桌子、椅子与角色 */
function StationSprite({ station }: { station: StationScene }) {
  const { slot } = station;
  const dimmed = station.state === "offline" || station.state === "disabled";
  return (
    <div
      className={styles.station}
      style={{
        transform: `translate3d(${slot.x}px, ${slot.y - DESK_H}px, 0) scale(${slot.scale})`,
      }}
    >
      <span
        className={styles.shadow}
        style={{
          left: SHADOW.x - SHADOW.w / 2,
          top: SHADOW.y,
          width: SHADOW.w,
          height: SHADOW.h,
        }}
      />
      <img
        className={styles.desk}
        src="/pix/desk.webp"
        width={DESK_W}
        height={DESK_H}
        style={{ width: DESK_W, height: DESK_H }}
        alt=""
      />
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
      />
      {/* 椅子画在角色之前（更靠近观众），遮住角色下半身 */}
      <img
        className={styles.chair}
        src="/pix/chair.webp"
        width={CHAIR_W}
        height={CHAIR_H}
        style={{ left: STATION.chair.x, top: STATION.chair.y, width: CHAIR_W, height: CHAIR_H }}
        alt=""
      />
    </div>
  );
}
