import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../../store/database.js";
import { hasConsoleCredential } from "../credential.js";

/** bootstrap mode 下开放的最小集合(01 §2):健康检查、bootstrap 接口与 enroll 兑换;
 *  非 /api 静态资源放行,让 /setup 页可加载;其余业务 API 一律 403。 */
const BOOTSTRAP_ALLOW = new Set([
  "/healthz",
  "/api/bootstrap/admin",
  "/api/bootstrap/status",
  "/api/bootstrap/artifacts",
  "/api/aw-node/enroll",
]);

/**
 * 无凭据 bootstrap mode 门控:每请求查库判定(单行主键查询),
 * 口令落库后立即解锁,无需重启。
 */
export function requireConsoleReadiness(db: Db) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (await hasConsoleCredential(db)) {
      return;
    }
    const path = request.url.split("?")[0] ?? request.url;
    if (BOOTSTRAP_ALLOW.has(path)) {
      return;
    }
    if (path.startsWith("/api/")) {
      await reply.code(403).send({
        error: {
          code: "BOOTSTRAP_REQUIRED",
          message: "控制台未初始化,请先在 /setup 完成管理员设置",
        },
      });
    }
    // 非 /api 静态资源放行:/setup 是 SPA 路由,业务数据全走被拦的 /api
  };
}
