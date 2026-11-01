import type { FastifyReply } from "fastify";

/** 路由层统一的 422 响应体,避免各路由各拼一份 error 结构 */
export function invalid(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(422).send({ error: { code: "VALIDATION_FAILED", message } });
}
