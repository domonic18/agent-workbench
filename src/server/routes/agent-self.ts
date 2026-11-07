import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../../store/database.js";
import {
  updateAgentFeishuBot,
  type AgentRecord,
} from "../../store/repositories/agent.js";
import { requireAgentAuth } from "../middleware/agent-auth.js";

const feishuBotSchema = z.object({
  open_id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(128),
  /** 该 bot 所属应用;由 proxy 从自己的凭据来源上报,非敏感 */
  app_id: z.string().trim().min(1).max(128).optional(),
});

export interface AgentSelfRoutesOptions {
  db: Db;
  now?: () => number;
}

/** bot 身份由 Agent 自己的 proxy 启动时经 /bot/v3/info 取得后上报;重复上报天然幂等 */
export function registerAgentSelfRoutes(
  app: FastifyInstance,
  options: AgentSelfRoutesOptions,
): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const auth = requireAgentAuth(db);

  app.put("/api/agents/self/feishu-bot", { preHandler: auth }, async (request, reply) => {
    const agent = request.agent as AgentRecord;
    const parsed = feishuBotSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({
        error: { code: "VALIDATION_FAILED", message: "open_id 与 name 必须是非空字符串" },
      });
    }
    const applied = await updateAgentFeishuBot(
      db,
      agent.id,
      parsed.data.open_id,
      parsed.data.name,
      parsed.data.app_id ?? null,
      now(),
    );
    if (!applied) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Agent 不存在" } });
    }
    return { ok: true };
  });
}
