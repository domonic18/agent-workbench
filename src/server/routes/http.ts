import type { FastifyReply } from "fastify";
import type { z } from "zod";

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
