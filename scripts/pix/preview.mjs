/**
 * 预览图：把工位（桌子 + 角色 + 椅子）按工位局部坐标拼出来，
 * 用来核对构图比例，不用靠浏览器反复调。
 *
 * 这里的局部坐标与 web/src/components/agents/office/pix/geometry.ts 的 STATION
 * 保持一致（脚本是 mjs、运行时是 ts，只能各写一份，改一处要记得改另一处）。
 *
 * 同一排渲染多个动作：坐姿与站姿的落位必须同时在一个画面里比，
 * 只看一个动作看不出角色是陷进地板还是浮在椅子上面。
 */

import path from "node:path";
import { canvas, sharp } from "./pixel.mjs";
import { SHEET_COLS } from "./sheet-config.mjs";

/** 预览放大倍数 */
const SCALE = 2;
/** 角色站位（工位局部坐标） */
const ACTOR_X = 30;
/** 桌子左上角（工位局部坐标） */
const DESK_X = 0;
/** 角色脚底相对桌底边的落差 */
const FEET_GAP = 12;
/** 椅子底边相对脚底的落差 */
const CHAIR_GAP = 8;
/** 单个工位预览格的宽高 */
const CELL_W = 240;
const CELL_H = 460;
/** 工位预览整体的顶部留白 */
const TOP_0 = 190;
/** 参与构图比对的动作 */
const PREVIEW_CLIPS = [
  "idle.back",
  "work.quiet-back",
  "work.typing-back",
  "sit.back",
  "pose.lean",
];

/**
 * 生成预览图。
 *
 * @param packSheets 每个角色的帧表产物
 * @param furniture 桌椅显示尺寸
 * @param outDir 成品目录（桌椅与角色 webp）
 * @param srcDir 预览图输出目录
 * @param geometry 帧框几何（pivot 与脚线位置）
 */
export async function writePreviews(packSheets, furniture, outDir, srcDir, geometry) {
  const desk = await sharp(path.join(outDir, "desk.webp"))
    .resize({ width: furniture.deskW * SCALE })
    .png()
    .toBuffer();
  const chair = await sharp(path.join(outDir, "chair.webp"))
    .resize({ width: furniture.chairW * SCALE, height: furniture.chairH * SCALE })
    .png()
    .toBuffer();

  await writeFrameGrid(packSheets, outDir, srcDir);

  const feetY = furniture.deskH + FEET_GAP;
  const chairX = ACTOR_X - furniture.chairW / 2;
  const chairY = feetY + CHAIR_GAP - furniture.chairH;

  // 构图比对：前两个角色 × 多个动作，逐行铺开
  const rows = Math.min(2, packSheets.length);
  const scene = [];
  for (let row = 0; row < rows; row += 1) {
    const entry = packSheets[row];
    for (const [index, clipId] of PREVIEW_CLIPS.entries()) {
      const clip = entry.clips[clipId];
      if (clip === undefined) continue;
      const slot = clip.slots[0];
      const base = index * CELL_W;
      const top = TOP_0 + row * CELL_H;
      scene.push({ input: desk, left: base + DESK_X * SCALE, top });
      scene.push({
        input: await sharp(path.join(outDir, "characters", `${entry.id}.webp`))
          .extract({
            left: (slot % SHEET_COLS) * entry.frameW,
            top: Math.floor(slot / SHEET_COLS) * entry.frameH,
            width: entry.frameW,
            height: entry.frameH,
          })
          .resize({ width: entry.frameW * SCALE, height: entry.frameH * SCALE })
          .png()
          .toBuffer(),
        left: base + Math.round(ACTOR_X * SCALE - geometry.pivotX * SCALE),
        top: top + Math.round(feetY * SCALE - geometry.footY * SCALE),
      });
      scene.push({
        input: chair,
        left: base + Math.round(chairX * SCALE),
        top: top + Math.round(chairY * SCALE),
      });
    }
  }
  await canvas(CELL_W * PREVIEW_CLIPS.length, CELL_H * rows)
    .composite(scene)
    .png()
    .toFile(path.join(srcDir, "preview-scene.png"));
}

/** 帧表预览：每个角色一行，按槽位顺序排开 */
async function writeFrameGrid(packSheets, outDir, srcDir) {
  const grid = [];
  const count = packSheets[0]?.placements.length ?? 0;
  for (const [row, entry] of packSheets.entries()) {
    for (let cell = 0; cell < count; cell += 1) {
      grid.push({
        input: await sharp(path.join(outDir, "characters", `${entry.id}.webp`))
          .extract({
            left: (cell % SHEET_COLS) * entry.frameW,
            top: Math.floor(cell / SHEET_COLS) * entry.frameH,
            width: entry.frameW,
            height: entry.frameH,
          })
          .png()
          .toBuffer(),
        left: cell * entry.frameW,
        top: row * entry.frameH,
      });
    }
  }
  const gridW = Math.max(...packSheets.map((e) => e.frameW)) * count;
  const gridH = Math.max(...packSheets.map((e) => e.frameH)) * packSheets.length;
  await canvas(gridW, gridH).composite(grid).png().toFile(path.join(srcDir, "preview-frames.png"));
}
