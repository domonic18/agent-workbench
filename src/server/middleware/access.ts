import type { Db } from "../../store/database.js";
import { requireAgentAuth } from "./agent-auth.js";
import { requireSession, type PreHandler } from "./session.js";

/**
 * 双通道鉴权:控制台会话或 Agent Bearer 皆可。
 * 带 Authorization 头按 Agent 判,否则按会话判——同一路由人机共用。
 */
export function requireSessionOrAgent(db: Db, now: () => number): PreHandler {
  const agent = requireAgentAuth(db);
  const session = requireSession(db, now);
  return async (request, reply) => {
    if (request.headers.authorization !== undefined) {
      return agent(request, reply);
    }
    return session(request, reply);
  };
}
