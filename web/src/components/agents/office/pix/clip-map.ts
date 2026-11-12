import type { OfficeState } from "../office-state.js";

/** 上游 PixOffice 角色素材包（经 scripts/build-pix-assets.mjs 加工） */
export const PIX_PACKS = [
  "code-agent",
  "office-lead",
  "data-agent",
  "file-agent",
  "app-agent",
  "review-agent",
] as const;

/**
 * 状态 → 动作片段。
 * 工位上的角色一律背向视角（面向桌子）：素材里准备的是背面站姿与打字姿势。
 */
export const STATE_CLIP: Record<OfficeState, string> = {
  running: "work.typing-back",
  idle: "idle.back",
  hold: "pose.lean",
  offline: "idle.back",
  disabled: "idle.back",
};

/** 走位片段：从左侧入场 */
export const WALK_CLIP = "walk.right";

/**
 * Agent → 角色素材包。
 * 名册里的 Agent 与六套素材没有对应关系，用 id 哈希稳定分配，
 * 同一个 Agent 每次刷新都拿到同一张脸。
 */
export function packOf(agentId: string): string {
  let hash = 5381;
  for (let index = 0; index < agentId.length; index += 1) {
    hash = ((hash << 5) + hash + agentId.charCodeAt(index)) >>> 0;
  }
  return PIX_PACKS[hash % PIX_PACKS.length] ?? PIX_PACKS[0];
}
