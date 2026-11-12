/**
 * 办公室像素场景的几何常量。
 *
 * 坐标一律以房间底图像素（1424×1105）为基准，渲染时整层缩放到容器宽度，
 * 因此桌椅与角色的相对关系只在这里定义一次。
 *
 * 工位内部的偏移（STATION）是「工位局部坐标」：工位元素被平移到
 * (slot.x, slot.y - DESK_H) 后再按 slot.scale 缩放，所以局部坐标 → 房间坐标
 * 的换算只有一处，命中层必须用同一个换算，否则名牌会跟角色错位。
 *
 * 桌椅与角色的显示尺寸来自素材构建产物（web/src/assets/pix/manifest.ts），
 * 不在这里复写一份——素材重做后尺寸会变，写死就会和图对不上。
 */

import {
  PIX_CHARACTER_H,
  PIX_CHAIR_H,
  PIX_CHAIR_W,
  PIX_DESK_H,
  PIX_DESK_W,
} from "../../../../assets/pix/manifest.js";

/** 房间底图尺寸 */
export const ROOM_W = 1424;
export const ROOM_H = 1105;

/**
 * 桌子显示尺寸
 *
 * 与素材的固有显示尺寸一致（脚本按宽度缩放到这个值），不做拉伸。
 */
export const DESK_W = PIX_DESK_W;
export const DESK_H = PIX_DESK_H;

/**
 * 椅子显示尺寸
 *
 * 椅子按高度缩放：坐垫到椅背的整幅画布高 82，实体约占其中四分之三。
 */
export const CHAIR_W = PIX_CHAIR_W;
export const CHAIR_H = PIX_CHAIR_H;

/** 每行工位数与工位横向间距 */
export const COLS = 6;
const PITCH = 200;

/** 房间水平中心 */
const CENTER_X = ROOM_W / 2;

/** 角色从脚线到头顶的高度（素材帧的角色高度） */
export const ACTOR_H = PIX_CHARACTER_H;

/** 入场走位距离（房间像素）：角色从画面左侧远处走到自己的工位 */
export const WALK_DISTANCE = 420;

/** 行参数：越靠下的行越靠前、越大、横向越宽（透视） */
const ROW_BASE_SINGLE = 860;
const ROW_BASE = 628;
const ROW_STEP = 300;
const ROW_SCALE_0 = 1;
const ROW_SCALE_STEP = 0.16;
const ROW_SPREAD_0 = 0.95;
const ROW_SPREAD_STEP = 0.05;
/** 房间里放得下的行数，超出时整层等比缩小 */
const ROWS_MAX = 2;

export interface StationSlot {
  row: number;
  col: number;
  /** 桌面左上角 x（房间像素） */
  x: number;
  /** 桌底基线 y（房间像素） */
  y: number;
  /** 该行的透视缩放 */
  scale: number;
}

/** 工位及其所属分组 */
export interface PlacedStation {
  group: number;
  slot: StationSlot;
}

/** 场景布局结果 */
export interface SceneLayout {
  placed: PlacedStation[];
  /** 总行数 */
  rows: number;
  /** 工位层缩放锚点（第一行基线） */
  origin: { x: number; y: number };
  /** 工位层整体缩放：行数超容量时等比缩小 */
  scale: number;
}

/** 第 row 行的透视参数，超出可见行数时按公式外推 */
function rowSpec(row: number, rows: number): { baseY: number; scale: number; spread: number } {
  const base = rows === 1 ? ROW_BASE_SINGLE : ROW_BASE;
  return {
    baseY: base + ROW_STEP * row,
    scale: Math.min(1.16, ROW_SCALE_0 + ROW_SCALE_STEP * row),
    spread: Math.min(1, ROW_SPREAD_0 + ROW_SPREAD_STEP * row),
  };
}

/**
 * 按机器分组铺工位。
 *
 * 同一台机器的 Agent 必须挨在一起——分区标签标在组内第一个工位上方，
 * 组一旦被拆到两行，标签就会指错人。放不下的整组整体挪到下一行，
 * 单组超过一行容量时才允许跨行拆开。
 */
export function layoutGroups(groupSizes: readonly number[]): SceneLayout {
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;
  const flush = (): void => {
    if (row.length > 0) {
      rows.push(row);
      row = [];
      used = 0;
    }
  };

  for (let group = 0; group < groupSizes.length; group += 1) {
    let left = groupSizes[group] ?? 0;
    while (left > 0) {
      const fit = COLS - used;
      if (fit <= 0) {
        flush();
        continue;
      }
      if (left > fit) {
        const hasOther = row.some((item) => item !== group);
        if (hasOther) {
          flush();
          continue;
        }
        for (let i = 0; i < fit; i += 1) row.push(group);
        used += fit;
        left -= fit;
        flush();
        continue;
      }
      row.push(group);
      used += 1;
      left -= 1;
    }
  }
  flush();

  const rowCount = Math.max(1, rows.length);
  const placed: PlacedStation[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const members = rows[rowIndex] ?? [];
    const spec = rowSpec(rowIndex, rowCount);
    for (let col = 0; col < members.length; col += 1) {
      const offset = (col - (members.length - 1) / 2) * PITCH * spec.spread;
      placed.push({
        group: members[col] ?? 0,
        slot: {
          row: rowIndex,
          col,
          x: CENTER_X + offset - DESK_W / 2,
          y: spec.baseY,
          scale: spec.scale,
        },
      });
    }
  }

  const scale = Math.min(1, ROWS_MAX / rowCount);
  const origin = { x: CENTER_X, y: rowSpec(0, rowCount).baseY };
  return { placed, rows: rowCount, origin, scale };
}

/**
 * 工位内部偏移（工位局部坐标）
 *
 * 构图：桌子在后，角色站在桌前偏左，椅子画在角色之前（更靠近观众），
 * 遮住角色的下半身——椅背朝向观众，坐在椅子里的人朝桌子。
 *
 * 角色站位偏左而不是居中：显示器在桌面中部偏右，居中时角色正好挡在屏幕前面，
 * 偏一点才能让屏幕从角色右侧露出来。
 */
const ACTOR_X = 30;

/** 角色脚底相对桌子底边的落差（角色站在桌前的地面上） */
const ACTOR_FOOT_GAP = 12;

export const STATION = {
  /** 椅子：与角色同轴，画在角色之前 */
  chair: { x: ACTOR_X - CHAIR_W / 2, y: DESK_H + ACTOR_FOOT_GAP + 8 - CHAIR_H },
  /** 角色脚底：桌前，与角色同轴 */
  feet: { x: ACTOR_X, y: DESK_H + ACTOR_FOOT_GAP },
  /** 名牌：椅子下方 */
  label: { x: ACTOR_X, y: DESK_H + ACTOR_FOOT_GAP + 24 },
  /** 用量徽标：名牌下一行 */
  badge: { x: ACTOR_X, y: DESK_H + ACTOR_FOOT_GAP + 50 },
  /** 分区标签：角色头顶上方 */
  zone: { x: ACTOR_X, y: DESK_H + ACTOR_FOOT_GAP - ACTOR_H - 34 },
} as const;

/** 地面投影：椭圆罩住角色脚下的落地范围 */
export const SHADOW = {
  x: ACTOR_X,
  y: DESK_H + ACTOR_FOOT_GAP - 6,
  w: 92,
  h: 26,
} as const;
