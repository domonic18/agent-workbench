import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CONSOLE_PASSWORD_MIN_LENGTH, LOGIN_LOCKOUT } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { deleteOtherSessions } from "../../store/repositories/session.js";
import { updateConsolePassword, verifyConsolePassword } from "../credential.js";
import { createLoginLockoutGuard } from "../login-lockout.js";
import {
  clearSessionCookie,
  endSession,
  isSecureRequest,
  requireCsrf,
  requireIdempotencyKey,
  requireSession,
  sessionCookie,
  sessionIdFrom,
  startSession,
} from "../middleware/session.js";
import { invalid, invalidSchema } from "./http.js";

export interface AuthRoutesOptions {
  db: Db;
  now?: () => number;
}

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(CONSOLE_PASSWORD_MIN_LENGTH),
});

export function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const lockout = createLoginLockoutGuard({ db, now });

  app.post("/api/auth/login", async (request, reply) => {
    // 锁定期内不校验口令,避免用响应差异探测口令是否正确
    if (await lockout.isLocked()) {
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
      await lockout.fail();
      return reply.code(401).send({
        error: { code: "UNAUTHORIZED", message: "口令错误" },
      });
    }
    await lockout.succeed();
    const { id, expiresAt } = await startSession(db, now);
    reply.header("set-cookie", sessionCookie(id, isSecureRequest(request)));
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
      reply.header("set-cookie", clearSessionCookie(isSecureRequest(request)));
      return { ok: true };
    },
  );

  /**
   * 改管理员口令。会话与口令哈希彼此独立,所以这里只改哈希:
   * 当前设备的会话照常保留,其余会话被吊销——吊销其他设备是改口令的应有后果,
   * 但发起改动的这台机器不会被踢下线。
   */
  app.post(
    "/api/auth/password",
    { preHandler: [requireSession(db, now), requireCsrf(), requireIdempotencyKey()] },
    async (request, reply) => {
      const parsed = passwordChangeSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidSchema(reply, parsed.error);
      }
      if (await lockout.isLocked()) {
        return reply.code(429).send({
          error: {
            code: "RATE_LIMITED",
            message: `口令校验失败次数过多,请 ${LOGIN_LOCKOUT.lockMs / 60_000} 分钟后再试`,
          },
        });
      }
      if (!(await verifyConsolePassword(db, parsed.data.currentPassword))) {
        await lockout.fail();
        // 会话本身有效,只是当前口令不对:回 422 而不是 401,免得前端把用户踢去登录页
        return invalid(reply, "当前口令不正确");
      }
      if (parsed.data.currentPassword === parsed.data.newPassword) {
        return invalid(reply, "新口令不能与当前口令相同");
      }
      await lockout.succeed();
      await updateConsolePassword(db, parsed.data.newPassword);
      const currentSessionId = sessionIdFrom(request);
      if (currentSessionId === undefined) {
        // requireSession 已校验过会话存在;走到这里说明 cookie 没了,此时不动任何会话
        return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "未登录或会话已过期" } });
      }
      const revoked = await deleteOtherSessions(db, currentSessionId);
      return { ok: true, revokedSessions: revoked };
    },
  );
}
