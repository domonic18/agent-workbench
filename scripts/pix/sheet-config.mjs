/**
 * 帧表口径：我们消费哪些上游 clip，以及槽位怎么排。
 *
 * 这里只声明「用哪些动作」和槽位网格；每个 clip 的时间轴（哪些图、每张多久）
 * 全部来自上游 character.json，仓库里不复制一份——上游改了图名或时长，
 * 这里的槽位分配会自动跟上，不会出现两处对不上的口径。
 *
 * 槽位按图片去重：同一个动作序列里复用同一张图（例如落座/起身复用站姿帧）
 * 只占一个格子，帧表因此保持在最小规模。
 */

/** 帧表网格尺寸：槽位按行优先排布 */
export const SHEET_COLS = 6;
export const SHEET_ROWS = 4;

/**
 * 消费的上游 clip，顺序即槽位分配顺序。
 *
 * 前半段是「持续动作」（可循环），后半段是「一次性动作」（过渡、表情）。
 */
export const CLIP_ORDER = [
  "idle.back",
  "work.quiet-back",
  "work.typing-back",
  "walk.right",
  "walk.back",
  "sit.back",
  "pose.lean",
  "pose.rise",
  "sit-down.back",
  "stand-up.back",
  "emote.wave",
  "emote.thinking",
  "emote.surprised",
];
