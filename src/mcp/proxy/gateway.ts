import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { awaitApproval } from "../../domain/capability/approval.js";
import { decide, type ToolCall } from "../../domain/capability/gate.js";
import { TOOL_GATE } from "../../shared/constants.js";
import { hashArgs } from "./hash.js";
import type { GatewayOptions, NativeTool, Upstream } from "./types.js";

export interface Gateway {
  listTools(): Tool[];
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
}

const SEPARATOR = "__";

/** 对外名 `mcp__<server>__<上游id>__<工具名>`,其中 `<server>__` 由 Claude Code 追加 */
export function exposeToolName(upstreamId: string, toolName: string): string {
  return `${upstreamId}${SEPARATOR}${toolName}`;
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

interface ResolvedTool {
  upstream: Upstream;
  toolName: string;
}

function resolveTool(upstreams: readonly Upstream[], exposedName: string): ResolvedTool | undefined {
  for (const upstream of upstreams) {
    const prefix = `${upstream.id}${SEPARATOR}`;
    if (!exposedName.startsWith(prefix)) {
      continue;
    }
    const toolName = exposedName.slice(prefix.length);
    if (upstream.tools().some((tool) => tool.name === toolName)) {
      return { upstream, toolName };
    }
  }
  return undefined;
}

export function createGateway(options: GatewayOptions): Gateway {
  const { ctx, upstreams, audit } = options;
  const nativeTools = options.nativeTools ?? [];
  const now = options.now ?? Date.now;
  const approvalTimeoutMs = options.approvalTimeoutMs ?? TOOL_GATE.approvalTimeoutMs;

  function listTools(): Tool[] {
    return [
      ...nativeTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
      ...upstreams.flatMap((upstream) =>
        upstream.tools().map((tool) => ({ ...tool, name: exposeToolName(upstream.id, tool.name) })),
      ),
    ];
  }

  async function forward(
    upstream: Upstream,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    try {
      return await upstream.callTool(toolName, args);
    } catch (error) {
      options.log?.warn({ err: error, tool: toolName }, "上游工具调用失败");
      return errorResult(`上游工具调用失败:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function executeNative(tool: NativeTool, args: Record<string, unknown>): Promise<CallToolResult> {
    return tool.execute(args).catch((error: unknown) => {
      options.log?.warn({ err: error, tool: tool.name }, "原生工具调用失败");
      return errorResult(
        `原生工具调用失败:${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  /** 原生工具与上游共用同一条判定链:decide → 审计 → (拒绝/审批) → 执行 */
  async function runGated(
    gateName: string,
    args: Record<string, unknown>,
    execute: () => Promise<CallToolResult>,
  ): Promise<CallToolResult> {
    const call: ToolCall = { tool: gateName, args };
    const decision = decide(ctx, call);
    const capabilityId =
      decision.verdict === "allow" && decision.capabilityId !== undefined
        ? decision.capabilityId
        : null;

    // 先落审计再执行:写失败即拒绝(05 §6.4),不放行「先跑后记」
    try {
      audit({
        runId: ctx.runId,
        agentId: ctx.agentId,
        taskId: ctx.taskId,
        tool: gateName,
        argsHash: hashArgs(args),
        level: decision.level,
        verdict: decision.verdict,
        reason: decision.reason ?? null,
        capabilityId,
        durationMs: null,
        occurredAt: now(),
      });
    } catch (error) {
      options.log?.error({ err: error, tool: gateName }, "工具审计写入失败,拒绝执行");
      return errorResult(`审计写入失败,已拒绝执行「${gateName}」`);
    }

    if (decision.verdict === "deny") {
      return errorResult(decision.reason);
    }
    if (decision.verdict === "require_approval") {
      const outcome = await awaitApproval(
        { ctx, call, reason: decision.reason },
        options.approval,
        approvalTimeoutMs,
      );
      if (outcome !== "approved") {
        const why =
          outcome === "timeout"
            ? `审批超时(${approvalTimeoutMs}ms)`
            : outcome === "rejected"
              ? "审批未通过"
              : "审批通道不可用或异常";
        return errorResult(`「${gateName}」需人工审批,${why},已拒绝`);
      }
    }
    return execute();
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const native = nativeTools.find((tool) => tool.name === name);
    if (native !== undefined) {
      return runGated(native.gateName, args, () => executeNative(native, args));
    }
    const target = resolveTool(upstreams, name);
    if (target === undefined) {
      return errorResult(`未知工具「${name}」,未转发`);
    }
    const gateName = options.toolMap?.[target.upstream.id]?.[target.toolName] ?? target.toolName;
    return runGated(gateName, args, () => forward(target.upstream, target.toolName, args));
  }

  return { listTools, callTool };
}
