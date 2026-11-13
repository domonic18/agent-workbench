/**
 * 办公室场景的布局模型。
 *
 * 把「名册 + 活体状态」摊成工位视图，再把工位局部坐标换算成舞台坐标——
 * 两件事都不含 React，画布组件与命中层共用同一份换算，名牌才不会跟角色错位。
 */

import type { AgentRosterSummary } from "../../../api/identity.js";
import type { OverviewAgent } from "../../../api/types.js";
import { officeClipOf } from "./office-behavior.js";
import { officeStateOf, type OfficeState } from "./office-state.js";
import { packOf, propOf, type PropId } from "./pix/clip-map.js";
import { DESK_H, layoutGroups, PITCH, WALK_DISTANCE, type StationSlot } from "./pix/geometry.js";

/** 走位速度（房间像素/秒），用来换算走位时长 */
const WALK_SPEED = 300;
/** 入场错峰间隔 */
const WALK_STAGGER = 120;

export interface StationScene {
  agent: AgentRosterSummary;
  live: OverviewAgent | undefined;
  state: OfficeState;
  slot: StationSlot;
  pack: string;
  clip: string;
  prop: PropId | null;
  walkMs: number;
  delay: number;
}

export interface ZoneView {
  key: string;
  label: string;
  count: number;
  first: StationScene;
}

export interface SceneLayout {
  stations: StationScene[];
  zones: ZoneView[];
  /** 工位层缩放锚点（第一行基线） */
  origin: { x: number; y: number };
  /** 工位层整体缩放：行数超容量时等比缩小 */
  roomScale: number;
}

/**
 * 名册 + 活体状态 → 工位视图。
 *
 * 按机器分组，同组挨在一起（分组不跨行由 layoutGroups 保证）。
 */
export function buildScene(
  agents: readonly AgentRosterSummary[],
  liveById: ReadonlyMap<string, OverviewAgent>,
): SceneLayout {
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
  const stations: StationScene[] = [];
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
      clip: officeClipOf(state, live),
      prop: propOf(agent.id),
      walkMs,
      delay: stations.length * WALK_STAGGER,
    };
    stations.push(view);
    // 分区标签取组内最前排的那份：跨行时前排的标签更好认
    frontOfGroup.set(item.group, view);
  }

  const zones: ZoneView[] = [];
  groupList.forEach((group, index) => {
    const first = frontOfGroup.get(index);
    if (first === undefined) return;
    zones.push({
      key: groupEntries[index]?.[0] ?? `${index}`,
      label: group.label,
      count: group.members.length,
      first,
    });
  });

  return { stations, zones, origin: layout.origin, roomScale: layout.scale };
}

/** 工位局部坐标 → 舞台坐标的换算，以及随间距收敛的覆盖层宽度 */
export interface StageMapper {
  toStage(slot: StationSlot, localX: number, localY: number): { left: number; top: number };
  /** 相邻工位的屏幕间距 */
  pitchOf(slot: StationSlot): number;
  /** 名牌 / 徽标的宽度上限 */
  overlayWidthOf(slot: StationSlot): number;
}

/**
 * 两层变换必须完全一致：工位层先按 slot.scale 摆位，再按房间容量整体缩放，
 * 命中层照抄同样的换算，名牌才不会跟角色错位。
 */
export function createStageMapper(params: {
  scale: number;
  roomScale: number;
  origin: { x: number; y: number };
}): StageMapper {
  const { scale, roomScale, origin } = params;
  const toStage = (slot: StationSlot, localX: number, localY: number) => {
    const roomX = slot.x + localX * slot.scale;
    const roomY = slot.y - DESK_H + localY * slot.scale;
    const layerX = origin.x + (roomX - origin.x) * roomScale;
    const layerY = origin.y + (roomY - origin.y) * roomScale;
    return { left: layerX * scale, top: layerY * scale };
  };
  /** 相邻工位的屏幕间距 */
  const pitchOf = (slot: StationSlot): number =>
    PITCH * slot.spread * slot.scale * roomScale * scale;
  return {
    toStage,
    pitchOf,
    /**
     * 名牌是屏幕固定尺寸，不会随房间缩小，窄容器里两两相撞；
     * 宽度按工位实际间距收敛后，名字再长也只在自己的格子里省略。
     */
    overlayWidthOf: (slot) => Math.max(32, Math.min(150, Math.floor(pitchOf(slot) - 8))),
  };
}
