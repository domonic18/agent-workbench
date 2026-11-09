import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createWorkerService } from "../../domain/work/worker-service.js";
import { WorkError } from "../../domain/work/errors.js";
import { WORK_HOLD_REASONS } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import type { AgentRecord } from "../../store/repositories/agent.js";
import { requireAgentAuth } from "../middleware/agent-auth.js";
import { parseWaitMs } from "./a2a.js";
import { invalid } from "./http.js";

/**
 * Agent Bearer 直调的工作收件箱通道(arch/01 §9.3 / §10):
 * 领取与探视(peek)派工、派发闸门挂起原因上报(M3.10,dispatch-coordination.md §3.1.5)。
 */

export interface WorkAgentRoutesOptions {
  db: Db;
  now?: () => number;
  /** 协作播报群;首次挂起卡片发到这里,留空则不入队 */
  collabChatId?: string;
}

const holdSchema = z.object({ reason: z.enum(WORK_HOLD_REASONS) });

export function registerWorkAgentRoutes(
  app: FastifyInstance,
  options: WorkAgentRoutesOptions,
): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const workers = createWorkerService({
    db,
    now,
    ...(options.collabChatId === undefined ? {} : { collabChatId: options.collabChatId }),
  });
  const agentAuth = requireAgentAuth(db);

  app.get("/api/work/inbox", { preHandler: agentAuth }, async (request, reply) => {
    const agent = request.agent as AgentRecord;
    const query = request.query as Record<string, unknown>;

    let waitMs: number | undefined;
    if (query.wait !== undefined) {
      if (typeof query.wait !== "string") {
        return invalid(reply, "wait 必须形如 25s 或 250ms");
      }
      waitMs = parseWaitMs(query.wait);
      if (waitMs === undefined) {
        return invalid(reply, "wait 必须形如 25s 或 250ms");
      }
    }

    // peek 只看不领(照 a2a peek 先例):aw-node 调度器预检用,不占行租约
    let peek: boolean | undefined;
    if (query.peek !== undefined) {
      if (query.peek !== "1" && query.peek !== "true") {
        return invalid(reply, "peek 只能是 1 或 true");
      }
      peek = true;
    }

    try {
      const views = await workers.inbox(agent.id, {
        ...(waitMs === undefined ? {} : { waitMs }),
        ...(peek === undefined ? {} : { peek }),
      });
      return {
        items: views.map(({ inbox, workItem }) => ({
          inbox_id: inbox.id,
          kind: inbox.kind,
          status: inbox.status,
          trigger_id: inbox.triggerId,
          lease_until: inbox.leaseUntil,
          work_item_id: inbox.workItemId,
          work_item_title: workItem.title,
          created_at: inbox.createdAt,
        })),
      };
    } catch (error) {
      if (error instanceof WorkError) {
        return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });

  app.post("/api/work/hold", { preHandler: agentAuth }, async (request, reply) => {
    const agent = request.agent as AgentRecord;
    const parsed = holdSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalid(reply, `reason 只接受 ${WORK_HOLD_REASONS.join(" / ")}`);
    }
    try {
      await workers.reportHold(agent.id, parsed.data.reason);
      return { ok: true };
    } catch (error) {
      if (error instanceof WorkError) {
        return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });
}
