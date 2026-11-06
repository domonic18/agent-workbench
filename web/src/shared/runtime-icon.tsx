import { Blocks, Brain, Code, SquareTerminal, type LucideIcon } from "lucide-react";
import type { AgentRuntime } from "../api/types.js";

/**
 * 运行时图标:语义化通用图标(lucide 没有品牌 logo)。
 * 图标只表意,全名由 Tooltip 与 aria-label 给出。
 */
export const RUNTIME_ICON: Record<AgentRuntime, LucideIcon> = {
  claude_code: SquareTerminal,
  workbuddy: Blocks,
  codex: Code,
  deepseek: Brain,
};
