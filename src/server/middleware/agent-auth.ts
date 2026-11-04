import type { FastifyReply } from "fastify";
import type { Db } from "../../store/database.js";
import { findAgentById, type AgentRecord } from "../../store/repositories/identity.js";
import { verifySecret } from "../../domain/security/secrets.js";
import { parseBearer } from "./bearer.js";
import type { PreHandler } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    /** 通过 Bearer 鉴权后挂上的 Agent 身份;未通过鉴权的路由读不到 */
    agent?: AgentRecord;
  }
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
    const parts = parseBearer(request.headers.authorization);
    if (parts === undefined) {
      return unauthorized(reply);
    }
    const agent = await findAgentById(db, parts.id);
    if (agent === undefined || agent.status !== "active") {
      return unauthorized(reply);
    }
    // bootstrap 确认的 Agent 在首次配置拉取前没有密钥;与不匹配同返回 401,不泄漏状态
    if (agent.secretHash === null || !verifySecret(parts.secret, agent.secretHash)) {
      return unauthorized(reply);
    }
    request.agent = agent;
    return undefined;
  };
}
