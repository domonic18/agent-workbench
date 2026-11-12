/**
 * 像素素材加工的底层工具：抠底色、裁切、等比缩放、贴片合成。
 *
 * 文生图产出的素材统一用洋红纯色作底（模型对「纯色底 + 主体」最稳定，
 * 真实透明底容易出灰边），这里把洋红底抠掉并清掉边缘残留。
 */

import sharp from "sharp";

/** 边缘残留：靠近洋红但被压暗/掺白的过渡像素 */
function isFringe(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 12 || max < 40) return false;
  const sat = d / max;
  if (sat < 0.12) return false;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return h >= 272 && h <= 340;
}

/** 取原始 RGBA 像素 */
export async function rawOf(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * 抠掉洋红底并清掉边缘残留。
 *
 * 底色不是「按颜色全局替换」，而是从格子边缘向内做泛洪填充：
 * 只填与底色相近且与边缘连通的像素。角色的紫色卫衣这类接近底色的部分
 * 不与边缘连通，不会被误抠掉。
 *
 * 之后做两轮「贴边残留」清理：与透明像素相邻、且色相偏向洋红的实心像素
 * 一律转透明，否则主体边缘会留一圈粉色描边。
 */
export async function keyOut(input) {
  const { data, width, height } = await rawOf(input);
  const key = borderColor(data, width, height);
  const filled = floodFill(data, width, height, key);
  for (let i = 0; i < data.length; i += 4) {
    if (filled[i / 4]) data[i + 3] = 0;
  }
  // 模型有时在洋红底外圈留一圈白色暗角：它同样贴边，也要抠掉，
  // 否则裁切时整条白边会把主体框在中间，缩放后只剩一小块。
  const halo = floodFill(data, width, height, null, isBright);
  for (let i = 0; i < data.length; i += 4) {
    if (halo[i / 4]) data[i + 3] = 0;
  }
  for (let pass = 0; pass < 2; pass += 1) {
    let removed = 0;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const p = y * width + x;
        const i = p * 4;
        if (data[i + 3] === 0) continue;
        const around =
          data[i - 4 + 3] === 0 ||
          data[i + 4 + 3] === 0 ||
          data[i - width * 4 + 3] === 0 ||
          data[i + width * 4 + 3] === 0;
        if (!around) continue;
        if (!isFringe(data[i], data[i + 1], data[i + 2])) continue;
        data[i + 3] = 0;
        removed += 1;
      }
    }
    if (removed === 0) break;
  }
  despeckle(data, width, height);
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** 亮色：白边/暗角一类的高亮低饱和像素 */
function isBright(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return min > 170 && max - min < 70;
}

/**
 * 去掉孤立的实心像素。
 *
 * 泛洪的边界上偶尔会留下单个不与边缘连通的杂点：它不影响观感，
 * 却会让裁切框多出一圈空白，把主体缩成一小块。
 */
function despeckle(data, width, height) {
  const solid = (x, y) => data[(y * width + x) * 4 + 3] > 16;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!solid(x, y)) continue;
      const around =
        (x > 0 && solid(x - 1, y)) ||
        (x < width - 1 && solid(x + 1, y)) ||
        (y > 0 && solid(x, y - 1)) ||
        (y < height - 1 && solid(x, y + 1));
      if (!around) data[(y * width + x) * 4 + 3] = 0;
    }
  }
}

/**
 * 取底色：边框像素里出现最多的颜色。
 *
 * 不能只看四角：模型有时在洋红底外圈画一圈白色暗角，四角全被染白，
 * 四角中位数会取到淡紫而不是真正的洋红，泛洪就抠不动了。
 * 边框众数则一定是底色本身。
 */
function borderColor(data, width, height) {
  const buckets = new Map();
  const picks = [];
  const collect = (x, y) => {
    const i = (y * width + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, { count: 1, sum: [r, g, b] });
    } else {
      bucket.count += 1;
      bucket.sum[0] += r;
      bucket.sum[1] += g;
      bucket.sum[2] += b;
    }
    picks.push(key);
  };
  for (let x = 0; x < width; x += 1) {
    collect(x, 0);
    collect(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    collect(0, y);
    collect(width - 1, y);
  }
  let best = null;
  for (const bucket of buckets.values()) {
    if (best === null || bucket.count > best.count) best = bucket;
  }
  if (best === null) return [255, 0, 255];
  return [
    Math.round(best.sum[0] / best.count),
    Math.round(best.sum[1] / best.count),
    Math.round(best.sum[2] / best.count),
  ];
}

/**
 * 从边缘向内泛洪，标记与底色相近的连通像素。
 *
 * 容差按亮度自适应：底色偏亮时留的余量更大，模型给的底色不会刚好卡在阈值上。
 * 传入 match 谓词时改用谓词判定（用于抠白边暗角）。
 */
function floodFill(data, width, height, key, match) {
  const tol = 120;
  const filled = new Uint8Array(width * height);
  const queue = [];
  const near = (p) => {
    const i = p * 4;
    if (match !== null && match !== undefined) {
      return match(data[i], data[i + 1], data[i + 2]);
    }
    const dr = data[i] - key[0];
    const dg = data[i + 1] - key[1];
    const db = data[i + 2] - key[2];
    return Math.sqrt(dr * dr + dg * dg + db * db) <= tol;
  };
  const push = (p) => {
    if (filled[p] === 1) return;
    if (!near(p)) return;
    filled[p] = 1;
    queue.push(p);
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (queue.length > 0) {
    const p = queue.pop();
    const x = p % width;
    const y = Math.floor(p / width);
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (y > 0) push(p - width);
    if (y < height - 1) push(p + width);
  }
  return filled;
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
