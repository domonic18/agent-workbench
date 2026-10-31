import { TOOL_GATE, type ToolLevel } from "../../shared/constants.js";

/** 用量状态由宿主注入;M2-5 尚未接账本,一律 unlimited,但判定入口与顺序先固定(M4-1 只填数据) */
export type UsageState =
  | { kind: "unlimited" }
  | { kind: "metered"; usedTokens: number; dailyLimit: number }
  | { kind: "unavailable"; reason: string };

export interface RunContext {
  runId: string;
  agentId: string;
  taskId: string;
  workspaceRoot: string;
  usage: UsageState;
  /** 已生效授权对应的点分工具名;命中即放行,免去逐次审批 */
  grants: readonly string[];
}

export interface ToolCall {
  /** 闸门侧统一用点分名,如 `task.create` / `fs.read` */
  tool: string;
  args: Readonly<Record<string, unknown>>;
}

export type Decision =
  | { verdict: "allow"; level: ToolLevel; reason?: string }
  | { verdict: "require_approval"; level: "L2"; reason: string }
  | { verdict: "deny"; level: ToolLevel; reason: string };

const L0_TOOLS = new Set<string>(TOOL_GATE.l0);
const L1_TOOLS = new Set<string>(TOOL_GATE.l1);

/** 白名单之外一律 L2;不做「看起来无害」的猜测 */
export function classifyTool(tool: string): ToolLevel {
  if (L0_TOOLS.has(tool)) {
    return "L0";
  }
  if (L1_TOOLS.has(tool)) {
    return "L1";
  }
  return "L2";
}

function usageDecision(usage: UsageState, level: ToolLevel): Decision | undefined {
  if (usage.kind === "unavailable") {
    return {
      verdict: "deny",
      level,
      reason: `今日用量读取失败(${usage.reason}),按已达上限处理;请稍后重试或联系控制台核对`,
    };
  }
  if (usage.kind === "metered" && usage.usedTokens >= usage.dailyLimit) {
    return {
      verdict: "deny",
      level,
      reason: `今日 token 已用尽(${usage.usedTokens}/${usage.dailyLimit}),所有工具调用均停止;请等待次日或调整上限`,
    };
  }
  return undefined;
}

/**
 * 唯一判定实现(05 §6.3):用量硬停 → 能力/白名单 → 等级。
 * 任何异常都按 deny 处理,不允许 fail-open。
 */
export function decide(ctx: RunContext, call: ToolCall): Decision {
  try {
    const level = classifyTool(call.tool);
    const stopped = usageDecision(ctx.usage, level);
    if (stopped !== undefined) {
      return stopped;
    }
    if (level === "L0" || level === "L1") {
      return { verdict: "allow", level };
    }
    if (ctx.grants.includes(call.tool)) {
      return { verdict: "allow", level, reason: "命中已生效授权" };
    }
    return {
      verdict: "require_approval",
      level: "L2",
      reason: `「${call.tool}」属于 L2 高危动作,需人工审批;常驻需求请在控制台申请能力授权`,
    };
  } catch (error) {
    return {
      verdict: "deny",
      level: "L2",
      reason: `判定异常,按拒绝处理:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
