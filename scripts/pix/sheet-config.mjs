/**
 * 角色姿态表的切分口径：素材是 3×2 的格子表，clip 定义各动作占哪几格。
 *
 * 单独成文件是因为加工脚本与预览脚本都要用同一份口径——
 * 两边各写一份，改了格子数就会对不上。
 */

/** 姿态表切成 3×2 */
export const SHEET_COLS = 3;
export const SHEET_ROWS = 2;

/** 动作片段 → 用到的格子与单轮时长（毫秒） */
export const CLIPS = [
  { id: "idle.back", cells: [0], duration: 1400 },
  { id: "work.typing-back", cells: [1, 2], duration: 520 },
  { id: "pose.lean", cells: [3], duration: 1600 },
  { id: "walk.right", cells: [4, 5], duration: 620 },
];
