import type { FastifyInstance } from "fastify";
import { IdentityError } from "../../domain/identity/errors.js";
import { formatKeysetCursor } from "../../shared/cursor.js";
import type { Db } from "../../store/database.js";
import { findAgentById } from "../../store/repositories/agent.js";
import {
  listTimelineEventsByAgent,
  type AgentTimelineRow,
} from "../../store/repositories/agent-timeline.js";
import { requireSession } from "../middleware/session.js";
import { parseListQuery } from "./http.js";
import { sendError } from "./identity.js";

/** 对话流事件:kind 与 payload 由采集侧定义,这里原样透出(已解析成对象) */
export interface AgentTimelineEntryDto {
  id: string;
  runId: string;
  runProject: string;
  runMachine: string;
  kind: string;
  occurredAt: number;
  payload: Record<string, unknown>;
}

export interface AgentTimelineResponse {
  items: AgentTimelineEntryDto[];
  /** 更早一页的游标;没有更多时为 null */
  nextCursor: string | null;
}

export interface AgentDetailRoutesOptions {
  db: Db;
  now?: () => number;
}

function toEntryDto(row: AgentTimelineRow): AgentTimelineEntryDto {
  return {
    id: row.id,
    runId: row.runId,
    runProject: row.runProject,
    runMachine: row.runMachine,
    kind: row.kind,
    occurredAt: row.occurredAt,
    payload: row.payload,
  };
}

/**
 * Agent 对话流只读接口。
 * 过程数据只对已登录控制台会话开放,不含跨 Agent 的查询能力。
 */
export function registerAgentDetailRoutes(
  app: FastifyInstance,
  options: AgentDetailRoutesOptions,
): void {
  const db = options.db;
  const session = requireSession(db, options.now ?? Date.now);

  app.get("/api/agents/:id/timeline", { preHandler: session }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = parseListQuery(request.query as Record<string, unknown>, reply);
    if (query === undefined) {
      return reply;
    }
    const agent = await findAgentById(db, id);
    if (agent === undefined) {
      return sendError(reply, new IdentityError("NOT_FOUND", "Agent 不存在"));
    }
    // 多取一条判断还有没有更早的
    const rows = await listTimelineEventsByAgent(db, {
      agentId: id,
      limit: query.limit + 1,
      ...(query.before === undefined
        ? {}
        : { before: { occurredAt: query.before.createdAt, id: query.before.id } }),
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const oldest = page.at(-1);
    return {
      items: [...page].reverse().map(toEntryDto),
      nextCursor:
        hasMore && oldest !== undefined
          ? formatKeysetCursor({ createdAt: oldest.occurredAt, id: oldest.id })
          : null,
    };
  });
}
