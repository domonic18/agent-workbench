import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { IngestError } from "../../domain/ingest/errors.js";
import { createIngestService, type IngestService } from "../../domain/ingest/service.js";
import { INGEST } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import {
  listActiveAgentProjects,
  type MachineRecord,
  touchMachineLastSeen,
} from "../../store/repositories/machine.js";
import { requireMachineAuth } from "../middleware/machine-auth.js";

const heartbeatSchema = z.object({
  uptime: z.number().int().min(0).optional(),
  pending_bytes: z.number().int().min(0).optional(),
  unattributed_streams: z.number().int().min(0).optional(),
  cpu: z.number().optional(),
  mem: z.number().optional(),
  last_error: z.string().nullable().optional(),
  streams: z.array(z.unknown()).max(1000).optional(),
});

const itemSchema = z.object({
  seq: z.number().int().min(1),
  inode: z.number().int().min(0).nullish(),
  offset: z.number().int().min(0).nullish(),
  kind: z.string().min(1),
  occurred_at: z.number().int().min(1),
  payload: z.unknown(),
});

const ingestSchema = z
  .object({
    collector_id: z.string().min(1),
    agent_project: z.string().min(1),
    stream_id: z.string().min(1),
    batch: z.array(itemSchema).min(1).max(INGEST.batchMax),
    sent_at: z.number().int().min(1).nullish(),
  })
  .superRefine((body, ctx) => {
    // 采集器按 seq 单调推送;乱序说明上游坏了,整批拒收而不是替它重排
    for (let i = 1; i < body.batch.length; i += 1) {
      if (body.batch[i]!.seq <= body.batch[i - 1]!.seq) {
        ctx.addIssue({
          code: "custom",
          path: ["batch", i, "seq"],
          message: "seq 必须严格递增",
        });
        return;
      }
    }
  });

export interface IngestRoutesOptions {
  db: Db;
  now?: () => number;
  service?: IngestService;
}

function sendError(reply: FastifyReply, error: IngestError): FastifyReply {
  return reply.code(error.status).send({
    error: {
      code: error.code,
      message: error.message,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    },
  });
}

function validationError(reply: FastifyReply, issues: z.ZodError): FastifyReply {
  return reply.code(400).send({
    error: {
      code: "BAD_REQUEST",
      message: "字段缺失或类型错误",
      detail: issues.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
  });
}

export function registerIngestRoutes(app: FastifyInstance, options: IngestRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const service = options.service ?? createIngestService({ db, now });

  app.post("/api/ingest/heartbeat", { preHandler: [requireMachineAuth(db)] }, async (request, reply) => {
    const machine = request.machine as MachineRecord;
    const parsed = heartbeatSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }
    // 心跳只推进机器存活时间与取回可推送项目;CPU / 内存等指标不入库
    await touchMachineLastSeen(db, machine.id, now());
    return reply.code(200).send({
      ok: true,
      projects: await listActiveAgentProjects(db, machine.id),
      server_time: now(),
    });
  });

  app.get("/api/ingest/projects", { preHandler: [requireMachineAuth(db)] }, async (request, reply) => {
    const machine = request.machine as MachineRecord;
    return reply.code(200).send({
      projects: await listActiveAgentProjects(db, machine.id),
    });
  });

  app.post("/api/ingest", { preHandler: [requireMachineAuth(db)] }, async (request, reply) => {
    const machine = request.machine as MachineRecord;
    const parsed = ingestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }
    const body = parsed.data;

    // 采集器只能替自己推送:collector_id 与 Bearer 身份不符直接拒,不静默改写
    if (body.collector_id !== machine.id) {
      return reply.code(400).send({
        error: { code: "BAD_REQUEST", message: "collector_id 与采集器身份不一致" },
      });
    }

    try {
      const result = await service.ingestBatch({
        collectorId: machine.id,
        agentProject: body.agent_project,
        streamId: body.stream_id,
        items: body.batch.map((item) => ({
          seq: item.seq,
          kind: item.kind,
          occurredAt: item.occurred_at,
          payload: item.payload,
        })),
      });
      if (result.failed !== null) {
        request.log.warn(
          { collectorId: machine.id, streamId: body.stream_id, failed: result.failed },
          "采集入库在首个失败项处停止",
        );
      }
      if (result.rejected > 0) {
        request.log.warn(
          { collectorId: machine.id, streamId: body.stream_id, rejected: result.rejected },
          "采集入库跳过存不下的坏项",
        );
      }
      return reply.code(200).send({ acked_seq: result.ackedSeq, rejected: result.rejected });
    } catch (error) {
      if (error instanceof IngestError) {
        return sendError(reply, error);
      }
      throw error;
    }
  });
}
