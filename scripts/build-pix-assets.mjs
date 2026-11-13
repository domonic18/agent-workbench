/**
 * 把上游 PixOffice 像素素材加工成前端可直接消费的静态资源。
 *
 * 输入：.pix-src/ 下的原始 PNG（房间底图、桌子、椅子、六套角色动作包、桌面小物）
 * 产出：
 *   web/public/pix/          房间、桌椅、桌面小物、角色 sprite sheet（运行时按 URL 懒加载）
 *   web/src/assets/pix/      生成的帧表全局样式与几何常量（编译期引用）
 *
 * 角色包的动作时间轴（哪些图、每张多久）全部读自上游 character.json，
 * 仓库里不复制一份；槽位按图片去重分配，跨动作复用的图只占一个格子。
 *
 * 对齐口径用上游 pivot（画布上的站立脚点）而不是「精灵底边贴地」：
 * 坐姿精灵的臀线比站姿低，底边贴地会让角色陷进地板。
 *
 * 用法：pnpm tsx scripts/build-pix-assets.mjs
 */
import { mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boundsOf, canvas, scaleToHeight, scaleToWidth, sharp, trim } from "./pix/pixel.mjs";
import { writePreviews } from "./pix/preview.mjs";
import { CLIP_ORDER, SHEET_COLS, SHEET_ROWS } from "./pix/sheet-config.mjs";

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

/** 角色显示高度（像素）：房间里的工位比例基准 */
const CHARACTER_H = 150;
/** 角色帧留白：底部留给脚线，顶部留给抬手等姿势 */
const FRAME_PAD_X = 6;
const FRAME_PAD_TOP = 4;
const FRAME_PAD_BOTTOM = 6;

/** 桌子按显示宽度缩放，椅子按显示高度缩放（椅背比人矮一截） */
const DESK_W = 132;
const CHAIR_H = 82;

/**
 * 桌面小物：上游 desk-accessories.png 的裁切框（原始像素坐标）
 *
 * 桌图自带显示器与键鼠，所以只取绿植、马克杯与书堆，不引上游的电脑图。
 * 三件都是柔和渲染的立体图，缩到桌面尺寸后统一按最近邻降采样，
 * 与房间的像素颗粒感对齐。
 */
const PROP_SOURCE = "desk-accessories.png";
const PROPS = [
  { id: "plant", left: 45, top: 133, width: 381, height: 474, h: 36 },
  { id: "mug", left: 1467, top: 374, width: 231, height: 222, h: 16 },
  { id: "books", left: 1728, top: 185, width: 314, height: 446, h: 24 },
];

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

/** 读一个角色的上游 manifest */
function readPackManifest(packDir) {
  return JSON.parse(readFileSync(path.join(SRC, "characters", packDir, "character.json"), "utf8"));
}

/**
 * 槽位分配：按 CLIP_ORDER 遍历，逐 clip 内按首次出现的图片分配新槽位。
 *
 * 同一张图跨 clip 复用时只占一个格子（落座/起身就是复用站姿帧拼出来的）。
 */
function assignSlots(manifest, clipOrder) {
  const slotOf = new Map();
  const clips = {};
  let next = 0;
  for (const clipId of clipOrder) {
    const clip = manifest.clips[clipId];
    if (clip === undefined) throw new Error(`素材缺少 clip ${clipId}`);
    const slots = [];
    const durations = [];
    for (const frame of clip.frames) {
      if (!slotOf.has(frame.file)) slotOf.set(frame.file, next++);
      slots.push(slotOf.get(frame.file));
      durations.push(frame.durationMs);
    }
    clips[clipId] = { slots, durations };
  }
  // Map 的插入顺序即槽位顺序：键是图片路径，值是槽位下标
  return { count: next, clips, files: [...slotOf.keys()] };
}

/** 读取一个角色的全部槽位图，并记下各自在画布上的内容外框 */
async function loadPackImages(pack, slots) {
  const images = [];
  for (const file of slots.files) {
    const buffer = await sharp(readFileSync(path.join(SRC, "characters", pack.dir, file)))
      .png()
      .toBuffer();
    images.push({ file, buffer, bounds: await boundsOf(buffer) });
  }
  return images;
}

/** 外框并集：所有角色的内容范围合起来才是所有 clip 共用的裁切窗口 */
function unionBox(images) {
  let left = Number.MAX_SAFE_INTEGER;
  let top = Number.MAX_SAFE_INTEGER;
  let right = -1;
  let bottom = -1;
  for (const image of images) {
    left = Math.min(left, image.bounds.left);
    top = Math.min(top, image.bounds.top);
    right = Math.max(right, image.bounds.left + image.bounds.width - 1);
    bottom = Math.max(bottom, image.bounds.top + image.bounds.height - 1);
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * 帧框几何：所有角色共用一套，帧表 CSS 与 manifest 都按它生成。
 *
 * 缩放用上游 referenceHeight（站立角色的参考高度）而不是「按待机格算比例」，
 * 六个角色因此画得一样大；锚点用上游 pivot，帧内位置 = 缩放后的 pivot 偏移。
 */
function frameGeometry(manifest, crop, referenceHeight) {
  const scale = CHARACTER_H / referenceHeight;
  const imageW = Math.round(crop.width * scale);
  const imageH = Math.round(crop.height * scale);
  return {
    scale,
    imageW,
    imageH,
    frameW: imageW + FRAME_PAD_X * 2,
    frameH: imageH + FRAME_PAD_TOP + FRAME_PAD_BOTTOM,
    pivotX: Math.round(FRAME_PAD_X + (manifest.pivot.x - crop.left) * scale),
    footY: Math.round(FRAME_PAD_TOP + (manifest.pivot.y - crop.top) * scale),
  };
}

/**
 * 把一个角色的帧拼成帧表。
 *
 * 每个格子画同一块裁切窗口的缩放图，槽位按行优先排布，
 * 偏移与 frames.css 里的 background-position 一一对应。
 */
async function buildSheet(pack, slots, images, geometry, crop) {
  const { frameW, frameH, imageW, imageH } = geometry;
  const placements = [];
  for (const [index, image] of images.entries()) {
    const scaled = await sharp(image.buffer)
      .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
      .resize({ width: imageW, height: imageH, fit: "fill" })
      .png()
      .toBuffer();
    placements.push({
      input: scaled,
      left: (index % SHEET_COLS) * frameW + FRAME_PAD_X,
      top: Math.floor(index / SHEET_COLS) * frameH + FRAME_PAD_TOP,
    });
  }

  const sheet = await canvas(SHEET_COLS * frameW, SHEET_ROWS * frameH)
    .composite(placements)
    .webp({ quality: 90, alphaQuality: 95, effort: 5 })
    .toBuffer();

  return { sheet, frameW, frameH, clips: slots.clips, placements };
}

function framePosition(index, frameW, frameH) {
  const col = index % SHEET_COLS;
  const row = Math.floor(index / SHEET_COLS);
  return `${-col * frameW}px ${-row * frameH}px`;
}

/**
 * 生成 clip 的 CSS：单帧给静态偏移，多帧按累计时长逐帧跳变。
 *
 * 停靠点按累计时间算而不是按帧数等分——上游各帧时长并不相等
 * （安静工作的最后一帧要停 1 秒），等分会把这个节奏抹平。
 */
function clipCss(clipId, clip, frameW, frameH) {
  const name = classNameOf(clipId);
  const total = clip.durations.reduce((a, b) => a + b, 0);
  const first = framePosition(clip.slots[0], frameW, frameH);
  if (clip.slots.length === 1) {
    return `.${name} {\n  background-position: ${first};\n}`;
  }
  const stops = [];
  let acc = 0;
  for (const [index, slot] of clip.slots.entries()) {
    stops.push(
      `  ${Math.round((acc / total) * 10000) / 100}% { background-position: ${framePosition(slot, frameW, frameH)}; }`,
    );
    acc += clip.durations[index];
  }
  // 末帧保持到 100%，循环回 0% 才不跳帧
  stops.push(
    `  100% { background-position: ${framePosition(clip.slots[clip.slots.length - 1], frameW, frameH)}; }`,
  );
  return (
    `.${name} {\n  background-position: ${first};\n` +
    `  animation: ${name} ${total}ms steps(1, end) infinite;\n}\n\n` +
    `@keyframes ${name} {\n${stops.join("\n")}\n}`
  );
}

/** 生成编译期引用的帧表全局样式与几何常量 */
async function writeGenerated(clips, geometry, furniture, props) {
  const { frameW, frameH, pivotX, footY } = geometry;
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
  rules.push(
    "@media (prefers-reduced-motion: reduce) {",
    "  .pix-sprite {",
    "    animation: none !important;",
    "  }",
    "}",
    "",
  );
  await writeFile(path.join(GEN, "frames.css"), `${rules.join("\n")}\n`, "utf8");

  const classMap = Object.fromEntries(Object.keys(clips).map((id) => [id, classNameOf(id)]));
  const durationMap = Object.fromEntries(
    Object.entries(clips).map(([id, c]) => [id, c.durations.reduce((a, b) => a + b, 0)]),
  );
  const footMap = Object.fromEntries(Object.entries(clips).map(([id]) => [id, footY]));
  const pivotMap = Object.fromEntries(Object.entries(clips).map(([id]) => [id, pivotX]));
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
/** 桌面小物尺寸（像素），键为素材 id */
export const PIX_PROP_SIZE: Record<string, { w: number; h: number }> = ${JSON.stringify(props, null, 2)};
`;
  await writeFile(path.join(GEN, "manifest.ts"), ts, "utf8");
}

/** 房间底图、桌子、椅子 */
async function buildRoomAndFurniture() {
  const room = await source("room.png");
  await room.webp({ quality: 84, effort: 5 }).toFile(path.join(OUT, "room.webp"));

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

/**
 * 桌面小物：裁切 → 去透明边 → 最近邻缩放到桌面尺寸。
 *
 * 最近邻是有意的：原图是柔和渲染的立体图，按面积平均会糊成一团，
 * 按最近邻降采样则得到与房间一致的硬边颗粒。
 */
async function buildProps() {
  const sizes = {};
  for (const prop of PROPS) {
    const crop = await sharp(readFileSync(path.join(SRC, PROP_SOURCE)))
      .extract({ left: prop.left, top: prop.top, width: prop.width, height: prop.height })
      .png()
      .toBuffer();
    const trimmed = await trim(crop);
    const box = await boundsOf(trimmed);
    const height = prop.h;
    const width = Math.max(1, Math.round((box.width / box.height) * height));
    const scaled = await sharp(trimmed)
      .resize({ width, height, fit: "fill", kernel: "nearest" })
      .png()
      .toBuffer();
    await sharp(scaled)
      .webp({ quality: 92, alphaQuality: 95, effort: 5 })
      .toFile(path.join(OUT, "props", `${prop.id}.webp`));
    sizes[prop.id] = { w: width, h: height };
  }
  return sizes;
}

async function main() {
  mkdirSync(path.join(OUT, "characters"), { recursive: true });
  mkdirSync(path.join(OUT, "props"), { recursive: true });
  mkdirSync(GEN, { recursive: true });

  const furniture = await buildRoomAndFurniture();
  const propSizes = await buildProps();

  // 逐包解析上游 manifest：槽位按图片去重分配
  const packs = [];
  for (const pack of PACKS) {
    const manifest = readPackManifest(pack.dir);
    const slots = assignSlots(manifest, CLIP_ORDER);
    const images = await loadPackImages(pack, slots);
    packs.push({ pack, manifest, slots, images });
  }

  // 裁切窗口取所有角色的内容并集：六个角色共用一套帧框几何
  const crop = unionBox(packs.flatMap((entry) => entry.images));
  const reference = packs[0].manifest;
  for (const entry of packs) {
    if (entry.manifest.referenceHeight !== reference.referenceHeight) {
      throw new Error(`角色 ${entry.pack.id} 的 referenceHeight 与首个角色不一致`);
    }
    if (entry.manifest.pivot.x !== reference.pivot.x || entry.manifest.pivot.y !== reference.pivot.y) {
      throw new Error(`角色 ${entry.pack.id} 的 pivot 与首个角色不一致`);
    }
  }
  const geometry = frameGeometry(reference, crop, reference.referenceHeight);

  // 六包的槽位序列必须一致，否则帧表 CSS 的偏移会对不上
  const signature = JSON.stringify(packs[0].slots.clips);
  for (const entry of packs) {
    if (JSON.stringify(entry.slots.clips) !== signature) {
      throw new Error(`角色 ${entry.pack.id} 的 clip 槽位序列与首个角色不一致`);
    }
  }

  const packSheets = [];
  for (const entry of packs) {
    const built = await buildSheet(entry.pack, entry.slots, entry.images, geometry, crop);
    await writeFile(path.join(OUT, "characters", `${entry.pack.id}.webp`), built.sheet);
    packSheets.push({ id: entry.pack.id, ...built });
    process.stdout.write(`[pix] ${entry.pack.id} 槽位=${entry.slots.count}\n`);
  }

  await writeGenerated(packs[0].slots.clips, geometry, furniture, propSizes);
  await writePreviews(packSheets, furniture, OUT, SRC, geometry);
  process.stdout.write(
    `[pix] 房间、桌椅、小物与帧表已生成 frame=${geometry.frameW}x${geometry.frameH} pivot=(${geometry.pivotX},${geometry.footY}) desk=${furniture.deskW}x${furniture.deskH} chair=${furniture.chairW}x${furniture.chairH}\n`,
  );
}

await main();
