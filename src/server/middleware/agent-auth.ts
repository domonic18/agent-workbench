import type { FastifyReply } from "fastify";
import type { Db } from "../../store/database.js";
import { findAgentById, type AgentRecord } from "../../store/repositories/identity.js";
import { verifySecret } from "../../domain/security/secrets.js";
import type { PreHandler } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    /** 通过 Bearer 鉴权后挂上的 Agent 身份;未通过鉴权的路由读不到 */
    agent?: AgentRecord;
  }
}

export interface BearerParts {
  agentId: string;
  secret: string;
}

/** `Bearer <agent_id>.<secret>`;agent_id 与 base64url 密钥都不含 `.`,按第一个 `.` 切 */
export function parseAgentBearer(header: string | undefined): BearerParts | undefined {
  if (header === undefined) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (match === null) {
    return undefined;
  }
  const value = match[1] ?? "";
  const index = value.indexOf(".");
  if (index <= 0 || index === value.length - 1) {
    return undefined;
  }
  return { agentId: value.slice(0, index), secret: value.slice(index + 1) };
}

function unauthorized(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .send({ error: { code: "UNAUTHORIZED", message: "Agent 鉴权失败" } });
}

/**
 * Agent Bearer 鉴权(01 §4):缺失、格式错、未知、disabled、密钥不匹配统一 401,
 * 不区分「不存在」与「不匹配」,避免枚举 Agent id。采集器密钥不走这里(M3)。
 */
export function requireAgentAuth(db: Db): PreHandler {
  return async (request, reply) => {
    const parts = parseAgentBearer(request.headers.authorization);
    if (parts === undefined) {
      return unauthorized(reply);
    }
    const agent = findAgentById(db, parts.agentId);
    if (agent === undefined || agent.status !== "active") {
      return unauthorized(reply);
    }
    if (!verifySecret(parts.secret, agent.secretHash)) {
      return unauthorized(reply);
    }
    request.agent = agent;
    return undefined;
  };
}
