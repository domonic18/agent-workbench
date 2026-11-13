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
  running: "work.quiet-back",
  idle: "idle.back",
  hold: "pose.lean",
  offline: "idle.back",
  disabled: "idle.back",
};

/** 走位片段：从左侧入场 */
export const WALK_CLIP = "walk.right";

/** 桌面小物的种类：桌图自带显示器与键鼠，这里只补可摆的零碎 */
export const PROP_IDS = ["plant", "mug", "books"] as const;

export type PropId = (typeof PROP_IDS)[number];

/**
 * 稳定哈希（djb2）。
 * 名册里的 Agent 与素材/道具都没有对应关系，用 id 哈希稳定分配，
 * 同一个 Agent 每次刷新都拿到同一张脸、同一件桌面小物。
 */
export function hashOf(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/**
 * Agent → 角色素材包。
 */
export function packOf(agentId: string): string {
  return PIX_PACKS[hashOf(agentId) % PIX_PACKS.length] ?? PIX_PACKS[0];
}

/**
 * Agent → 桌面小物。
 *
 * 约三分之一的工位留空：桌面摆太满反而看不清角色。
 */
export function propOf(agentId: string): PropId | null {
  const index = hashOf(`prop:${agentId}`) % (PROP_IDS.length + 1);
  return PROP_IDS[index] ?? null;
}
