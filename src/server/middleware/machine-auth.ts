import type { FastifyReply } from "fastify";
import type { Db } from "../../store/database.js";
import { findMachineById, type MachineRecord } from "../../store/repositories/identity.js";
import { verifySecret } from "../../domain/security/secrets.js";
import { parseBearer } from "./bearer.js";
import type { PreHandler } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    /** 通过 Bearer 鉴权后挂上的采集器身份;未通过鉴权的路由读不到 */
    machine?: MachineRecord;
  }
}

function unauthorized(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .send({ error: { code: "UNAUTHORIZED", message: "采集器鉴权失败" } });
}

/**
 * 采集器 Bearer 鉴权(01 §4):缺失、格式错、未知、disabled、密钥不匹配统一 401,
 * 不区分「不存在」与「不匹配」,避免枚举 machine id。
 */
export function requireMachineAuth(db: Db): PreHandler {
  return async (request, reply) => {
    const parts = parseBearer(request.headers.authorization);
    if (parts === undefined) {
      return unauthorized(reply);
    }
    const machine = findMachineById(db, parts.id);
    if (machine === undefined || machine.status !== "active") {
      return unauthorized(reply);
    }
    if (!verifySecret(parts.secret, machine.collectorSecretHash)) {
      return unauthorized(reply);
    }
    request.machine = machine;
    return undefined;
  };
}
