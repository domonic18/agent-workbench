import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { consumeAgentEnrollToken } from "../../domain/bootstrap/one-time-token.js";
import { IdentityError } from "../../domain/identity/errors.js";
import { createIdentityService, type IdentityService } from "../../domain/identity/service.js";
import { formatBearer } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { domainError, invalidSchema } from "./http.js";

const enrollSchema = z.object({
  token: z.string().trim().min(1, "token 必填"),
});

export interface AgentEnrollRoutesOptions {
  db: Db;
  now?: () => number;
  service?: IdentityService;
}

/**
 * Agent 自助接入(01 §5.3):用一次性令牌换自己的密钥。
 * 无控制台会话——令牌即凭据;兑换时轮换密钥,旧密钥立即失效。
 * 明文密钥只在本次响应出现一次,库中只存哈希。
 */
export function registerAgentEnrollRoutes(
  app: FastifyInstance,
  options: AgentEnrollRoutesOptions,
): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const service = options.service ?? createIdentityService({ db, now });

  app.post("/api/agent-enroll", async (request, reply) => {
    const parsed = enrollSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalidSchema(reply, parsed.error);
    }
    const consumed = await consumeAgentEnrollToken(db, { token: parsed.data.token, now });
    if (!consumed.ok) {
      return reply
        .code(consumed.reason === "invalid" ? 401 : 410)
        .send({ error: { code: "UNAUTHORIZED", message: "接入令牌无效或已失效" } });
    }
    try {
      const { agent, secret } = await service.rotateAgentSecret(consumed.agentId);
      return reply.code(201).send({
        agent_id: agent.id,
        secret,
        authorization: formatBearer(agent.id, secret),
      });
    } catch (error) {
      if (error instanceof IdentityError) {
        return domainError(reply, error);
      }
      throw error;
    }
  });
}
