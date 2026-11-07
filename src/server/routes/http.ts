import type { FastifyReply } from "fastify";
import type { z } from "zod";
import { LIST_LIMITS } from "../../shared/constants.js";
import { parseKeysetCursor } from "../../shared/cursor.js";

/** 路由层统一的 422 响应体,避免各路由各拼一份 error 结构 */
export function invalid(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(422).send({ error: { code: "VALIDATION_FAILED", message } });
}

/** zod 校验失败的 422 响应:detail 携带字段路径,便于调用方定位 */
export function invalidSchema(reply: FastifyReply, error: z.ZodError): FastifyReply {
  return reply.code(422).send({
    error: {
      code: "VALIDATION_FAILED",
      message: "字段缺失或类型错误",
      detail: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
  });
}

/** 领域错误(带 HTTP status 映射)统一转错误信封;detail 仅在存在时携带 */
export function domainError(
  reply: FastifyReply,
  error: { status: number; code: string; message: string; detail?: unknown },
): FastifyReply {
  return reply.code(error.status).send({
    error: {
      code: error.code,
      message: error.message,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    },
  });
}

/** 列表接口共用的分页参数解析:limit 与 keyset 游标,非法时直接回 422 */
export function parseListQuery(
  query: Record<string, unknown>,
  reply: FastifyReply,
): { limit: number; before?: { createdAt: number; id: string } } | undefined {
  const limit = typeof query.limit === "string" ? Number(query.limit) : LIST_LIMITS.default;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIST_LIMITS.max) {
    void invalid(reply, `limit 必须为 1~${LIST_LIMITS.max} 的整数`);
    return undefined;
  }
  const before = typeof query.cursor === "string" ? parseKeysetCursor(query.cursor) : undefined;
  if (typeof query.cursor === "string" && before === undefined) {
    void invalid(reply, "cursor 格式应为 <createdAt>:<id>");
    return undefined;
  }
  return { limit, ...(before === undefined ? {} : { before }) };
}
