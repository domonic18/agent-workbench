import { useMemo } from "react";
import type { AgentRosterSummary } from "../../../api/identity.js";
import type { OverviewAgent } from "../../../api/types.js";
import { agentDisplayName } from "../../../shared/agent-label.js";
import { formatTokens } from "../../../shared/format.js";
import { RuntimeIcon } from "../../../shared/runtime-icon.js";
import { OfficeCharacter, OFFICE_SLOT_H, OFFICE_SLOT_W } from "./OfficeCharacter.js";
import { OFFICE_STATE_LABEL, officeStateOf, type OfficeState } from "./office-state.js";
import styles from "./office.module.css";

const MAX_COLS = 4;
const LABEL_H = 24;
const ZONE_GAP = 32;
const HIT_W = 172;
const HIT_H = 28;

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

interface SlotLayout {
  agent: AgentRosterSummary;
  live: OverviewAgent | undefined;
  state: OfficeState;
  x: number;
  y: number;
}

interface ZoneLayout {
  key: string;
  label: string;
  start: number;
  width: number;
  height: number;
  slots: SlotLayout[];
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

/** 办公室视图：Agent 变成工位上的扁平小人，按机器分区，状态即姿势 */
export function AgentOfficeScene({ agents, liveById, onOpenDetail }: AgentOfficeSceneProps) {
  const { zones, width, height } = useMemo(() => {
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

    let offset = 0;
    const zoneList: ZoneLayout[] = [];
    for (const [key, group] of groups) {
      const cols = Math.min(MAX_COLS, group.members.length);
      const slots = group.members.map((agent, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const live = liveById.get(agent.id);
        return {
          agent,
          live,
          state: officeStateOf(agent, live),
          x: col * OFFICE_SLOT_W,
          y: LABEL_H + row * OFFICE_SLOT_H,
        };
      });
      const start = offset;
      offset += cols * OFFICE_SLOT_W + ZONE_GAP;
      zoneList.push({
        key,
        label: group.label,
        start,
        width: cols * OFFICE_SLOT_W,
        height: LABEL_H + Math.ceil(group.members.length / cols) * OFFICE_SLOT_H,
        slots,
      });
    }

    return {
      zones: zoneList,
      width: offset - (zoneList.length > 0 ? ZONE_GAP : 0),
      height: Math.max(...zoneList.map((zone) => zone.height)),
    };
  }, [agents, liveById]);

  if (zones.length === 0) {
    return null;
  }

  return (
    <div>
      <div className={styles.scene} role="group" aria-label="办公室视图">
        <svg
          className={styles.canvas}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
        >
          {zones.map((zone, index) => (
            <g key={zone.key}>
              {index > 0 ? (
                <line
                  x1={zone.start - ZONE_GAP / 2}
                  y1="10"
                  x2={zone.start - ZONE_GAP / 2}
                  y2={height - 10}
                  className={styles.divider}
                />
              ) : null}
              <text x={zone.start + 8} y={16} className={styles.zoneLabel}>
                {zone.label} · {zone.slots.length} 个工位
              </text>
              {zone.slots.map((slot) => (
                <g key={slot.agent.id} transform={`translate(${zone.start + slot.x} ${slot.y})`}>
                  <OfficeCharacter state={slot.state} />
                </g>
              ))}
            </g>
          ))}
        </svg>

        {zones.map((zone) =>
          zone.slots.map((slot) => {
            const name = agentDisplayName(slot.agent);
            const busy = busyText(slot.live);
            const tokens = slot.live?.todayTokens ?? 0;
            return (
              <span key={slot.agent.id}>
                {tokens > 0 ? (
                  <span
                    className={styles.tokenBadge}
                    style={{ left: zone.start + slot.x + OFFICE_SLOT_W - 84, top: slot.y + 6 }}
                  >
                    今日 {formatTokens(tokens)} tok
                  </span>
                ) : null}
                <button
                  type="button"
                  className={styles.hit}
                  style={{
                    left: zone.start + slot.x + (OFFICE_SLOT_W - HIT_W) / 2,
                    top: slot.y + OFFICE_SLOT_H - HIT_H - 8,
                  }}
                  aria-label={`${name}，${OFFICE_STATE_LABEL[slot.state]}，${busy}`}
                  title={`${name} · ${OFFICE_STATE_LABEL[slot.state]} · ${busy}`}
                  onClick={() => onOpenDetail(slot.agent)}
                >
                  <RuntimeIcon runtime={slot.agent.runtime} size={12} />
                  <span className={styles.hitName}>{name}</span>
                </button>
              </span>
            );
          }),
        )}
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
