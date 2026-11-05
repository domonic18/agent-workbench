import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { decide, type RunContext, type UsageState } from "../domain/capability/gate.js";
import { hashArgs } from "../shared/args-hash.js";
import type { Db } from "../store/database.js";
import type { AgentRecord } from "../store/repositories/identity.js";
import { insertToolCallLog } from "../store/repositories/tool-call-log.js";
import {
  errorResult,
  failureResult,
  type ConsoleLogger,
  type ConsoleTool,
} from "../mcp/console-shared.js";

export interface McpToolService {
  listTools(): { name: string; description: string; inputSchema: unknown }[];
  callTool(agent: AgentRecord, name: string, args: Record<string, unknown>): Promise<CallToolResult>;
}

export interface McpToolServiceDeps {
  db: Db;
  tools: readonly ConsoleTool[];
  /** M4-1 实时解析 Agent 用量状态;缺省无限量 */
  resolveUsage?: (agentId: string) => Promise<UsageState>;
  now?: () => number;
  log?: ConsoleLogger;
}

/**
 * 控制台 /mcp 工具调用应用服务(05 §6.3/§6.4):decide() 判定 → 审计落库 → 拒绝或执行。
 * 审计写失败即拒绝执行,不放行「先跑后记」;任何异常按 deny 处理,不 fail-open。
 */
export function createMcpToolService(deps: McpToolServiceDeps): McpToolService {
  const { db, tools } = deps;
  const resolveUsage = deps.resolveUsage ?? (async () => ({ kind: "unlimited" as const }));
  const now = deps.now ?? Date.now;

  return {
    listTools() {
      return tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      }));
    },
    async callTool(agent, name, args) {
      const tool = tools.find((entry) => entry.name === name);
      if (tool === undefined) {
        return errorResult(`未知工具「${name}」`);
      }

      const usage = await resolveUsage(agent.id);
      const ctx: RunContext = {
        runId: null,
        agentId: agent.id,
        taskId: tool.auditTaskId(args),
        workspaceRoot: null,
        usage,
        grants: [],
      };
      const decision = decide(ctx, { tool: tool.gateName, args });
      const capabilityId =
        decision.verdict === "allow" && decision.capabilityId !== undefined
          ? decision.capabilityId
          : null;

      try {
        await insertToolCallLog(db, {
          runId: null,
          agentId: agent.id,
          taskId: ctx.taskId,
          tool: tool.gateName,
          argsHash: hashArgs(args),
          level: decision.level,
          verdict: decision.verdict,
          reason: decision.reason ?? null,
          capabilityId,
          durationMs: null,
          occurredAt: now(),
        });
      } catch (error) {
        deps.log?.error({ err: error, tool: tool.gateName }, "工具审计写入失败,拒绝执行");
        return errorResult(`审计写入失败,已拒绝执行「${tool.gateName}」`);
      }

      if (decision.verdict === "deny") {
        return errorResult(decision.reason);
      }
      try {
        return await tool.execute(agent, args);
      } catch (error) {
        deps.log?.warn({ err: error, tool: tool.gateName }, "控制台工具执行失败");
        return failureResult(error);
      }
    },
  };
}
