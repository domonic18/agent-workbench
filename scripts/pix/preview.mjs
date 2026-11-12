/**
 * 预览图：把一个工位（桌子 + 角色 + 椅子）按工位局部坐标拼出来，
 * 用来核对构图比例，不用靠浏览器反复调。
 *
 * 这里的局部坐标与 web/src/components/agents/office/pix/geometry.ts 的 STATION
 * 保持一致（脚本是 mjs、运行时是 ts，只能各写一份，改一处要记得改另一处）。
 */

import path from "node:path";
import { canvas, sharp } from "./pixel.mjs";
import { CLIPS, SHEET_COLS } from "./sheet-config.mjs";

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
const CELL_H = 420;
/** 工位预览整体的顶部留白 */
const TOP_0 = 170;

/**
 * 生成两张预览图。
 *
 * @param packSheets 每个角色的帧表产物
 * @param furniture 桌椅显示尺寸
 * @param outDir 成品目录（桌椅与角色 webp）
 * @param srcDir 预览图输出目录
 */
export async function writePreviews(packSheets, furniture, outDir, srcDir) {
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

  // 工位预览：桌子 + 角色 + 椅子
  const scene = [];
  for (const [index, entry] of packSheets.slice(0, 3).entries()) {
    const base = index * CELL_W;
    scene.push({ input: desk, left: base + DESK_X * SCALE, top: TOP_0 });
    scene.push({
      input: await sharp(path.join(outDir, "characters", `${entry.id}.webp`))
        .extract({ left: 0, top: 0, width: entry.frameW, height: entry.frameH })
        .resize({ width: entry.frameW * SCALE, height: entry.frameH * SCALE })
        .png()
        .toBuffer(),
      left: base + Math.round(ACTOR_X * SCALE - entry.clips["idle.back"].pivotX * SCALE),
      top: TOP_0 + Math.round(feetY * SCALE - entry.footY * SCALE),
    });
    scene.push({
      input: chair,
      left: base + Math.round(chairX * SCALE),
      top: TOP_0 + Math.round(chairY * SCALE),
    });
  }
  await canvas(CELL_W * 3, CELL_H)
    .composite(scene)
    .png()
    .toFile(path.join(srcDir, "preview-scene.png"));
}

/** 帧表预览：每个角色一行，按 clip 顺序排开 */
async function writeFrameGrid(packSheets, outDir, srcDir) {
  const grid = [];
  const order = CLIPS.flatMap((clip) => clip.cells);
  for (const [row, entry] of packSheets.entries()) {
    for (const [col, cell] of order.entries()) {
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
        left: col * entry.frameW,
        top: row * entry.frameH,
      });
    }
  }
  const gridW = Math.max(...packSheets.map((e) => e.frameW)) * order.length;
  const gridH = Math.max(...packSheets.map((e) => e.frameH)) * packSheets.length;
  await canvas(gridW, gridH).composite(grid).png().toFile(path.join(srcDir, "preview-frames.png"));
}
