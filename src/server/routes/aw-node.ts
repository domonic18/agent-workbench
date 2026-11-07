import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ackMachineConfig, pullMachineConfig } from "../../domain/bootstrap/config-delivery.js";
import { saveDiscoveryReport } from "../../domain/bootstrap/discovery.js";
import { enrollMachine } from "../../domain/bootstrap/enroll.js";
import { BootstrapError } from "../../domain/bootstrap/errors.js";
import { consumeOneTimeToken } from "../../domain/bootstrap/one-time-token.js";
import { IdentityError } from "../../domain/identity/errors.js";
import { createIdentityService, type IdentityService } from "../../domain/identity/service.js";
import type { Db } from "../../store/database.js";
import { touchMachineLastSeen, type MachineRecord } from "../../store/repositories/machine.js";
import { requireMachineAuth } from "../middleware/machine-auth.js";
import { requireIdempotencyKey } from "../middleware/session.js";
import { domainError, invalidSchema } from "./http.js";

export interface AwNodeRoutesOptions {
  db: Db;
  now?: () => number;
  service?: IdentityService;
}

interface EnrollBody {
  token?: unknown;
  hostname?: unknown;
  os?: unknown;
  collector_version?: unknown;
}

function textOf(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new IdentityError("VALIDATION_FAILED", `${field} 必须是非空字符串`);
  }
  return value.trim();
}

const discoverySchema = z.object({
  // 允许空列表:执行机没装 cc-connect 时如实上报「扫描为空」,否则会每轮 422 死循环
  projects: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        cwd: z.string().max(1024).optional(),
        agents: z.array(z.unknown()).max(100).optional(),
        channels: z.array(z.unknown()).max(100).optional(),
        feishu_bot_name: z.string().max(128).optional(),
        feishu_bot_open_id: z.string().max(128).optional(),
      }),
    )
    .max(200),
});

const ackSchema = z.object({
  agents: z
    .array(
      z.object({
        agent_id: z.string().min(1),
        config_version: z.number().int().min(1),
      }),
    )
    .min(1)
    .max(100),
});

/**
 * 执行机加入(01 §2 / 04 §首次加入):安装脚本凭一次性 enroll token 兑换
 * 机器 ID 与长期采集密钥。无控制台会话,令牌即凭据;明文密钥只在响应出现一次。
 */
export function registerAwNodeRoutes(app: FastifyInstance, options: AwNodeRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const service = options.service ?? createIdentityService({ db, now });

  app.post("/api/aw-node/enroll", async (request, reply) => {
    const body = (request.body ?? {}) as EnrollBody;
    const token = typeof body.token === "string" ? body.token : "";
    if (token === "") {
      return reply.code(422).send({
        error: { code: "VALIDATION_FAILED", message: "token 必填" },
      });
    }
    let hostname: string;
    let os: string;
    let collectorVersion: string;
    try {
      hostname = textOf(body.hostname, "hostname");
      os = textOf(body.os, "os");
      collectorVersion = textOf(body.collector_version, "collector_version");
    } catch (error) {
      if (error instanceof IdentityError) {
        return reply.code(422).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
    const consumed = await consumeOneTimeToken(db, { purpose: "enroll", token, now });
    if (!consumed.ok) {
      return reply
        .code(consumed.reason === "invalid" ? 401 : 410)
        .send({ error: { code: "UNAUTHORIZED", message: "enroll token 无效或已失效" } });
    }
    const enrolled = await enrollMachine(
      { db, now, service },
      { hostname, os, collectorVersion },
    );
    return reply
      .code(201)
      .send({ machine_id: enrolled.machineId, collector_secret: enrolled.secret });
  });

  app.post(
    "/api/aw-node/discovery",
    { preHandler: [requireMachineAuth(db), requireIdempotencyKey()] },
    async (request, reply) => {
      const machine = request.machine as MachineRecord;
      const parsed = discoverySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidSchema(reply, parsed.error);
      }
      await saveDiscoveryReport(db, { machineId: machine.id, report: parsed.data, now });
      await touchMachineLastSeen(db, machine.id, now());
      return { ok: true, received_at: now() };
    },
  );

  // 不加幂等重放:ACK 前每次请求都轮换并返回最新密钥,轮换本身就是恢复手段(01 §4)
  app.post("/api/aw-node/config", { preHandler: [requireMachineAuth(db)] }, async (request, reply) => {
    const machine = request.machine as MachineRecord;
    try {
      return await pullMachineConfig({ db, now }, { machineId: machine.id });
    } catch (error) {
      if (error instanceof BootstrapError) {
        return domainError(reply, error);
      }
      throw error;
    }
  });

  app.post(
    "/api/aw-node/config/ack",
    { preHandler: [requireMachineAuth(db), requireIdempotencyKey()] },
    async (request, reply) => {
      const machine = request.machine as MachineRecord;
      const parsed = ackSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidSchema(reply, parsed.error);
      }
      try {
        const result = await ackMachineConfig(
          { db, now },
          {
            machineId: machine.id,
            acks: parsed.data.agents.map((entry) => ({
              agentId: entry.agent_id,
              configVersion: entry.config_version,
            })),
          },
        );
        return { ok: true, config_status: result.config_status, acked: result.acked };
      } catch (error) {
        if (error instanceof BootstrapError) {
          return domainError(reply, error);
        }
        throw error;
      }
    },
  );
}
