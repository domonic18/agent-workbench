import type { FastifyInstance } from "fastify";
import { LOGIN_LOCKOUT } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { verifyConsolePassword } from "../credential.js";
import { createLoginLockoutGuard } from "../login-lockout.js";
import {
  clearSessionCookie,
  endSession,
  requireCsrf,
  requireSession,
  sessionCookie,
  sessionIdFrom,
  startSession,
} from "../middleware/session.js";

export interface AuthRoutesOptions {
  db: Db;
  now?: () => number;
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const lockout = createLoginLockoutGuard({ db, now });

  app.post("/api/auth/login", async (request, reply) => {
    // 锁定期内不校验口令,避免用响应差异探测口令是否正确
    const source = request.ip;
    if (await lockout.isLocked(source)) {
      return reply.code(429).send({
        error: {
          code: "RATE_LIMITED",
          message: `登录失败次数过多,请 ${LOGIN_LOCKOUT.lockMs / 60_000} 分钟后再试`,
        },
      });
    }
    const body = request.body as { password?: unknown } | null;
    const password = typeof body?.password === "string" ? body.password : "";
    if (password === "") {
      return reply.code(422).send({
        error: { code: "VALIDATION_FAILED", message: "请提供口令" },
      });
    }
    if (!(await verifyConsolePassword(db, password))) {
      await lockout.fail(source);
      return reply.code(401).send({
        error: { code: "UNAUTHORIZED", message: "口令错误" },
      });
    }
    await lockout.succeed(source);
    const { id, expiresAt } = await startSession(db, now);
    reply.header("set-cookie", sessionCookie(id));
    return { ok: true, expiresAt };
  });

  app.post(
    "/api/auth/logout",
    { preHandler: [requireSession(db, now), requireCsrf()] },
    async (request, reply) => {
      const id = sessionIdFrom(request);
      if (id !== undefined) {
        await endSession(db, id);
      }
      reply.header("set-cookie", clearSessionCookie());
      return { ok: true };
    },
  );
}
