/**
 * 像素素材加工的底层工具：裁切、等比缩放、贴片合成。
 *
 * 当前素材来自上游 PixOffice（已带透明底），不再做洋红抠色。
 */

import sharp from "sharp";

/** 取原始 RGBA 像素 */
export async function rawOf(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** 不透明像素的外接框 */
export async function boundsOf(input) {
  const { data, width, height } = await rawOf(input);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) throw new Error("素材里没有不透明像素");
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** 裁到不透明区域 */
export async function trim(input) {
  const box = await boundsOf(input);
  return sharp(input).extract(box).png().toBuffer();
}

/** 等比缩放到指定高度 */
export async function scaleToHeight(input, height) {
  const box = await boundsOf(input);
  const width = Math.max(1, Math.round((box.width / box.height) * height));
  return { buffer: await sharp(input).resize({ height, width, fit: "fill" }).png().toBuffer(), width, height };
}

/** 按比例缩放到指定宽度 */
export async function scaleToWidth(input, width) {
  const box = await boundsOf(input);
  const height = Math.max(1, Math.round((box.height / box.width) * width));
  return { buffer: await sharp(input).resize({ width, height, fit: "fill" }).png().toBuffer(), height };
}

/** 生成一块透明画布 */
export function canvas(width, height) {
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  });
}

/** 导出 sharp 供调用方直接使用 */
export { sharp };
