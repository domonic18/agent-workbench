/**
 * 把上游 PixOffice 像素素材加工成前端可直接消费的静态资源。
 *
 * 输入：.pix-src/ 下的原始 PNG（房间底图、桌子、椅子、六套角色动作包）
 * 产出：
 *   web/public/pix/          房间、桌椅、角色 sprite sheet（运行时按 URL 懒加载）
 *   web/src/assets/pix/      生成的帧表全局样式与几何常量（编译期引用）
 *
 * PixOffice 角色包按动作拆成独立 PNG，这里按 3×2 帧表口径重新拼合：
 * 0=idle.back, 1-2=work.typing-back, 3=pose.lean, 4-5=walk.right。
 * 素材本身已带透明底，只裁去空白、归一缩放、脚底对齐，不再做洋红抠色。
 *
 * 用法：pnpm tsx scripts/build-pix-assets.mjs
 */
import { mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  boundsOf,
  canvas,
  scaleToHeight,
  scaleToWidth,
  sharp,
  trim,
} from "./pix/pixel.mjs";
import { writePreviews } from "./pix/preview.mjs";
import { CLIPS, SHEET_COLS, SHEET_ROWS } from "./pix/sheet-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, ".pix-src");
const OUT = path.join(ROOT, "web", "public", "pix");
const GEN = path.join(ROOT, "web", "src", "assets", "pix");

/** 角色素材包：对应 .pix-src/characters/ 下的 PixOffice pack 目录 */
const PACKS = [
  { id: "code-agent", dir: "code-agent" },
  { id: "office-lead", dir: "office-lead" },
  { id: "data-agent", dir: "data-agent" },
  { id: "file-agent", dir: "file-agent" },
  { id: "app-agent", dir: "app-agent" },
  { id: "review-agent", dir: "review-agent" },
];

/** 3×2 帧表每个格子对应的 PixOffice 动作文件（相对 pack 目录） */
const POSE_MAP = [
  "idle/back/001.png",
  "work/typing-back/001.png",
  "work/typing-back/002.png",
  "pose/lean/001.png",
  "walk/right/001.png",
  "walk/right/002.png",
];

/** 角色显示高度（像素）：房间里的工位比例基准 */
const CHARACTER_H = 150;
/** 角色帧留白：底部留给脚线，顶部留给抬手等姿势 */
const FRAME_PAD_X = 6;
const FRAME_PAD_TOP = 4;
const FRAME_PAD_BOTTOM = 6;

/** 桌子按显示宽度缩放，椅子按显示高度缩放（椅背比人矮一截） */
const DESK_W = 132;
const CHAIR_H = 82;

function classNameOf(clipId) {
  return `clip-${clipId.replace(/[^a-z0-9]+/gi, "-")}`;
}

/**
 * 读取原始素材。
 *
 * 刻意不做成 async：sharp 实例是 thenable，await 一次就变成输出 buffer，
 * 拿到的就不再是能继续走管线的实例了。
 */
function source(file) {
  return sharp(readFileSync(path.join(SRC, file)));
}

/**
 * 从 PixOffice 角色包里读一个独立姿态 PNG 并裁去透明边。
 *
 * 上游素材本身已带透明底，不需要洋红抠色。
 */
async function readPose(packDir, index) {
  const file = path.join(SRC, "characters", packDir, POSE_MAP[index] ?? "");
  const buffer = await sharp(readFileSync(file)).png().toBuffer();
  return trim(buffer);
}

/**
 * 加工一个角色的全部格子。
 *
 * 缩放比例由「待机」格决定：同一个角色在不同格子里画得一样大，
 * 按待机格归一后其余格子同比缩放，抬手等姿势不会显得忽大忽小。
 */
async function cutPack(pack) {
  const cells = [];
  for (let index = 0; index < SHEET_COLS * SHEET_ROWS; index += 1) {
    cells.push(await readPose(pack.dir, index));
  }
  const idleBox = await boundsOf(cells[0]);
  const scale = CHARACTER_H / idleBox.height;
  const frames = [];
  for (const cell of cells) {
    const box = await boundsOf(cell);
    const width = Math.max(1, Math.round(box.width * scale));
    const height = Math.max(1, Math.round(box.height * scale));
    const buffer = await sharp(cell).resize({ width, height, fit: "fill" }).png().toBuffer();
    // 裁切后的内容从 x=0 起，中心即宽的一半
    frames.push({ buffer, width, height, centerX: width / 2 });
  }
  return frames;
}

/**
 * 把一个角色的帧拼成 3×2 的 sheet。
 *
 * 每个 clip 的水平轴心取该 clip 各帧内容中心的均值，
 * 打字的两帧之间就不会左右抖动。
 */
async function buildSheet(frames, geometry) {
  const { frameW, frameH, footY } = geometry;

  const clips = {};
  const placements = [];
  let counter = 0;
  for (const clip of CLIPS) {
    const members = clip.cells.map((cell) => frames[cell]);
    // 轴心取帧框中心：所有角色共用一套帧表常量，
    // 每帧内容按各自宽度居中贴图，帧与帧之间不会左右漂
    const pivotX = Math.round(frameW / 2);
    const frameIndexes = [];
    for (const member of members) {
      frameIndexes.push(counter);
      // 帧在 sheet 里按行优先排布，偏移要和 framePosition 对得上
      placements.push({
        input: member.buffer,
        left: (counter % SHEET_COLS) * frameW + Math.round(pivotX - member.width / 2),
        top: Math.floor(counter / SHEET_COLS) * frameH + (footY - member.height),
      });
      counter += 1;
    }
    clips[clip.id] = {
      frames: frameIndexes,
      pivotX,
      footY,
      duration: clip.duration,
    };
  }

  const sheet = await canvas(SHEET_COLS * frameW, SHEET_ROWS * frameH)
    .composite(placements)
    .webp({ quality: 90, alphaQuality: 95, effort: 5 })
    .toBuffer();

  return { sheet, frameW, frameH, footY, clips, placements };
}

function framePosition(index, frameW, frameH) {
  const col = index % SHEET_COLS;
  const row = Math.floor(index / SHEET_COLS);
  return `${-col * frameW}px ${-row * frameH}px`;
}

/** 生成 clip 的 CSS：单帧给静态偏移，多帧用 steps(1, end) 逐帧跳变 */
function clipCss(clipId, clip, frameW, frameH) {
  const name = classNameOf(clipId);
  const first = framePosition(clip.frames[0], frameW, frameH);
  if (clip.frames.length === 1) {
    return `.${name} {\n  background-position: ${first};\n}`;
  }
  const stops = clip.frames.map(
    (frame, index) =>
      `  ${Math.round((index / clip.frames.length) * 10000) / 100}% { background-position: ${framePosition(frame, frameW, frameH)}; }`,
  );
  return `.${name} {\n  background-position: ${first};\n  animation: ${name} ${clip.duration}ms steps(1, end) infinite;\n}\n\n@keyframes ${name} {\n${stops.join("\n")}\n}`;
}

/** 生成编译期引用的帧表全局样式与几何常量 */
async function writeGenerated(shared, furniture) {
  const { frameW, frameH, clips } = shared;
  const rules = [
    "/* 由 scripts/build-pix-assets.mjs 生成，勿手改 */",
    "",
    ".pix-sprite {",
    `  width: ${frameW}px;`,
    `  height: ${frameH}px;`,
    "  background-repeat: no-repeat;",
    "}",
    "",
  ];
  for (const [clipId, clip] of Object.entries(clips)) {
    rules.push(clipCss(clipId, clip, frameW, frameH));
    rules.push("");
  }
  await writeFile(path.join(GEN, "frames.css"), `${rules.join("\n")}\n`, "utf8");

  const classMap = Object.fromEntries(Object.keys(clips).map((id) => [id, classNameOf(id)]));
  const durationMap = Object.fromEntries(Object.entries(clips).map(([id, c]) => [id, c.duration]));
  const footMap = Object.fromEntries(Object.entries(clips).map(([id, c]) => [id, c.footY]));
  const pivotMap = Object.fromEntries(Object.entries(clips).map(([id, c]) => [id, c.pivotX]));
  const ts = `// 由 scripts/build-pix-assets.mjs 生成，勿手改
export const PIX_FRAME_WIDTH = ${frameW};
export const PIX_FRAME_HEIGHT = ${frameH};
export const PIX_CLIP_CLASS: Record<string, string> = ${JSON.stringify(classMap, null, 2)};
/** 单轮动画时长（毫秒） */
export const PIX_CLIP_DURATION: Record<string, number> = ${JSON.stringify(durationMap, null, 2)};
/** 每帧内角色脚底所在的 y（像素），用于把角色贴到地面线 */
export const PIX_CLIP_FOOT_Y: Record<string, number> = ${JSON.stringify(footMap, null, 2)};
/** 每帧内角色的水平轴心（像素），用于让多帧之间不左右抖动 */
export const PIX_CLIP_PIVOT_X: Record<string, number> = ${JSON.stringify(pivotMap, null, 2)};
/** 角色显示高度（像素），从脚线到头顶 */
export const PIX_CHARACTER_H = ${CHARACTER_H};
/** 桌子显示尺寸（像素） */
export const PIX_DESK_W = ${furniture.deskW};
export const PIX_DESK_H = ${furniture.deskH};
/** 椅子显示尺寸（像素） */
export const PIX_CHAIR_W = ${furniture.chairW};
export const PIX_CHAIR_H = ${furniture.chairH};
`;
  await writeFile(path.join(GEN, "manifest.ts"), ts, "utf8");
}

/** 房间底图、桌子、椅子 */
async function buildRoomAndFurniture() {
  const room = await source("room.png");
  await room
    .webp({ quality: 84, effort: 5 })
    .toFile(path.join(OUT, "room.webp"));

  const desk = await trim(await source("desk.png").toBuffer());
  const deskSized = await scaleToWidth(desk, DESK_W);
  await sharp(deskSized.buffer)
    .webp({ quality: 90, alphaQuality: 95, effort: 5 })
    .toFile(path.join(OUT, "desk.webp"));

  const chair = await trim(await source("chair.png").toBuffer());
  const chairSized = await scaleToHeight(chair, CHAIR_H);
  await sharp(chairSized.buffer)
    .webp({ quality: 90, alphaQuality: 95, effort: 5 })
    .toFile(path.join(OUT, "chair.webp"));

  return {
    deskW: DESK_W,
    deskH: deskSized.height,
    chairW: chairSized.width,
    chairH: chairSized.height,
  };
}

async function main() {
  mkdirSync(path.join(OUT, "characters"), { recursive: true });
  mkdirSync(GEN, { recursive: true });

  const furniture = await buildRoomAndFurniture();

  // 帧框尺寸全局统一：帧表 CSS 与 manifest 是所有角色共用的
  const cut = [];
  for (const pack of PACKS) {
    cut.push({ pack, frames: await cutPack(pack) });
  }
  const contentW = Math.max(...cut.flatMap((c) => c.frames.map((f) => f.width)));
  const contentH = Math.max(...cut.flatMap((c) => c.frames.map((f) => f.height)));
  const geometry = {
    frameW: contentW + FRAME_PAD_X * 2,
    frameH: contentH + FRAME_PAD_TOP + FRAME_PAD_BOTTOM,
  };
  geometry.footY = geometry.frameH - FRAME_PAD_BOTTOM;

  const packSheets = [];
  let shared = null;
  for (const { pack, frames } of cut) {
    const built = await buildSheet(frames, geometry);
    await writeFile(path.join(OUT, "characters", `${pack.id}.webp`), built.sheet);
    const geometryKey = JSON.stringify({
      frameW: built.frameW,
      frameH: built.frameH,
      footY: built.footY,
      clips: built.clips,
    });
    if (shared === null) {
      shared = { ...built, id: pack.id };
    } else if (geometryKey !== JSON.stringify({
      frameW: shared.frameW,
      frameH: shared.frameH,
      footY: shared.footY,
      clips: shared.clips,
    })) {
      throw new Error(`角色 ${pack.id} 的帧几何与首个角色不一致，需重新生成 frames.css`);
    }
    packSheets.push({ id: pack.id, ...built });
    process.stdout.write(`[pix] ${pack.id} frames=${built.placements.length}\n`);
  }

  await writeGenerated(shared, furniture);
  await writePreviews(packSheets, furniture, OUT, SRC);
  process.stdout.write(
    `[pix] 房间、桌椅与帧表已生成 frame=${shared.frameW}x${shared.frameH} desk=${furniture.deskW}x${furniture.deskH} chair=${furniture.chairW}x${furniture.chairH}\n`,
  );
}

await main();
