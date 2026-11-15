import type { FastifyInstance } from "fastify";
import type { AgentRuntime, IdentityStatus } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { parseJsonStringArray } from "../../store/json.js";
import { type AgentRecord } from "../../store/repositories/agent.js";
import { resolveTargets } from "../../domain/delegation/targets.js";
import { requireAgentAuth } from "../middleware/agent-auth.js";

export interface AgentPeer {
  id: string;
  displayName: string;
  runtime: AgentRuntime;
  project: string;
  /** Agent 自报的飞书 bot 名;为空表示尚未回写 */
  feishuBotName: string | null;
  status: IdentityStatus;
  /** 经哪个组可达;直接授权时为 null */
  viaGroup: string | null;
  viaGroupName: string | null;
}

export interface AgentPeersRoutesOptions {
  db: Db;
}

function toPeer(
  row: AgentRecord,
  viaGroup: string | null = null,
  viaGroupName: string | null = null,
): AgentPeer {
  return {
    id: row.id,
    displayName: row.displayName,
    runtime: row.runtime,
    project: row.project,
    feishuBotName: row.feishuBotName,
    status: row.status,
    viaGroup,
    viaGroupName,
  };
}

/**
 * Agent 自查可委派目标(01 §5.3):委派白名单属于**发送方**,
 * 这里返回的正是「我能发给谁」——省去翻库查 agent id 的探索。
 */
export function registerAgentPeersRoutes(app: FastifyInstance, options: AgentPeersRoutesOptions): void {
  const db = options.db;
  const auth = requireAgentAuth(db);

  app.get("/api/agent/peers", { preHandler: auth }, async (request) => {
    const agent = request.agent as AgentRecord;
    const targets = parseJsonStringArray(agent.allowedTargetsJson);
    // 白名单里的组展开成成员:Agent 看到的「我能发给谁」是具体的人,不是组
    const resolved = await resolveTargets(db, targets);
    return {
      self: toPeer(agent),
      peers: resolved.map((item) =>
        toPeer(item.agent, item.viaGroupId, item.viaGroupName),
      ),
    };
  });
}
