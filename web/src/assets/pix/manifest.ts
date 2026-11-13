// 由 scripts/build-pix-assets.mjs 生成，勿手改
export const PIX_FRAME_WIDTH = 116;
export const PIX_FRAME_HEIGHT = 181;
export const PIX_CLIP_CLASS: Record<string, string> = {
  "idle.back": "clip-idle-back",
  "work.quiet-back": "clip-work-quiet-back",
  "work.typing-back": "clip-work-typing-back",
  "walk.right": "clip-walk-right",
  "walk.back": "clip-walk-back",
  "sit.back": "clip-sit-back",
  "pose.lean": "clip-pose-lean",
  "pose.rise": "clip-pose-rise",
  "sit-down.back": "clip-sit-down-back",
  "stand-up.back": "clip-stand-up-back",
  "emote.wave": "clip-emote-wave",
  "emote.thinking": "clip-emote-thinking",
  "emote.surprised": "clip-emote-surprised"
};
/** 单轮动画时长（毫秒） */
export const PIX_CLIP_DURATION: Record<string, number> = {
  "idle.back": 1000,
  "work.quiet-back": 4000,
  "work.typing-back": 640,
  "walk.right": 800,
  "walk.back": 800,
  "sit.back": 1000,
  "pose.lean": 1000,
  "pose.rise": 1000,
  "sit-down.back": 520,
  "stand-up.back": 520,
  "emote.wave": 1000,
  "emote.thinking": 1000,
  "emote.surprised": 1000
};
/** 每帧内角色脚底所在的 y（像素），用于把角色贴到地面线 */
export const PIX_CLIP_FOOT_Y: Record<string, number> = {
  "idle.back": 156,
  "work.quiet-back": 156,
  "work.typing-back": 156,
  "walk.right": 156,
  "walk.back": 156,
  "sit.back": 156,
  "pose.lean": 156,
  "pose.rise": 156,
  "sit-down.back": 156,
  "stand-up.back": 156,
  "emote.wave": 156,
  "emote.thinking": 156,
  "emote.surprised": 156
};
/** 每帧内角色的水平轴心（像素），用于让多帧之间不左右抖动 */
export const PIX_CLIP_PIVOT_X: Record<string, number> = {
  "idle.back": 57,
  "work.quiet-back": 57,
  "work.typing-back": 57,
  "walk.right": 57,
  "walk.back": 57,
  "sit.back": 57,
  "pose.lean": 57,
  "pose.rise": 57,
  "sit-down.back": 57,
  "stand-up.back": 57,
  "emote.wave": 57,
  "emote.thinking": 57,
  "emote.surprised": 57
};
/** 角色显示高度（像素），从脚线到头顶 */
export const PIX_CHARACTER_H = 150;
/** 桌子显示尺寸（像素） */
export const PIX_DESK_W = 132;
export const PIX_DESK_H = 84;
/** 椅子显示尺寸（像素） */
export const PIX_CHAIR_W = 79;
export const PIX_CHAIR_H = 82;
/** 桌面小物尺寸（像素），键为素材 id */
export const PIX_PROP_SIZE: Record<string, { w: number; h: number }> = {
  "plant": {
    "w": 29,
    "h": 36
  },
  "mug": {
    "w": 17,
    "h": 16
  },
  "books": {
    "w": 17,
    "h": 24
  }
};
