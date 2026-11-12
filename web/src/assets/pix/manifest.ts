// 由 scripts/build-pix-assets.mjs 生成，勿手改
export const PIX_FRAME_WIDTH = 127;
export const PIX_FRAME_HEIGHT = 162;
export const PIX_CLIP_CLASS: Record<string, string> = {
  "idle.back": "clip-idle-back",
  "work.typing-back": "clip-work-typing-back",
  "pose.lean": "clip-pose-lean",
  "walk.right": "clip-walk-right"
};
/** 单轮动画时长（毫秒） */
export const PIX_CLIP_DURATION: Record<string, number> = {
  "idle.back": 1400,
  "work.typing-back": 520,
  "pose.lean": 1600,
  "walk.right": 620
};
/** 每帧内角色脚底所在的 y（像素），用于把角色贴到地面线 */
export const PIX_CLIP_FOOT_Y: Record<string, number> = {
  "idle.back": 156,
  "work.typing-back": 156,
  "pose.lean": 156,
  "walk.right": 156
};
/** 每帧内角色的水平轴心（像素），用于让多帧之间不左右抖动 */
export const PIX_CLIP_PIVOT_X: Record<string, number> = {
  "idle.back": 64,
  "work.typing-back": 64,
  "pose.lean": 64,
  "walk.right": 64
};
/** 角色显示高度（像素），从脚线到头顶 */
export const PIX_CHARACTER_H = 150;
/** 桌子显示尺寸（像素） */
export const PIX_DESK_W = 132;
export const PIX_DESK_H = 145;
/** 椅子显示尺寸（像素） */
export const PIX_CHAIR_W = 61;
export const PIX_CHAIR_H = 82;
