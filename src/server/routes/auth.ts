import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CONSOLE_PASSWORD_MIN_LENGTH, LOGIN_LOCKOUT } from "../../shared/constants.js";
import {
  parseOpenIds,
  SYSTEM_CONFIG_KEYS,
  type FeishuConfig,
} from "../../config/env.js";
import { exchangeFeishuCode, FeishuOauthError, type FeishuOauthUser } from "../../adapters/feishu/oauth.js";
import type { Db } from "../../store/database.js";
import { readSystemConfig } from "../../store/repositories/system-config.js";
import { revokeOtherSessions, updateConsolePassword, verifyConsolePassword } from "../credential.js";
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
import { domainError, invalid, invalidSchema } from "./http.js";

export interface AuthRoutesOptions {
  db: Db;
  now?: () => number;
  feishu?: FeishuConfig;
  /** 免登 code 兑换;路由测试注入桩,缺省走飞书适配器出站 */
  exchangeFeishuCode?: (
    code: string,
    credentials: Pick<FeishuConfig, "appId" | "appSecret">,
  ) => Promise<FeishuOauthUser>;
}

async function resolveFeishuRuntime(
  db: Db,
  envFallback?: FeishuConfig,
): Promise<FeishuConfig | undefined> {
  const rows = await readSystemConfig(db);
  const dbAppId = rows[SYSTEM_CONFIG_KEYS.feishuAppId];
  const dbAppSecret = rows[SYSTEM_CONFIG_KEYS.feishuAppSecret];
  if (dbAppId === undefined && dbAppSecret === undefined && envFallback === undefined) {
    return undefined;
  }
  const appId = dbAppId ?? envFallback?.appId ?? "";
  const appSecret = dbAppSecret ?? envFallback?.appSecret ?? "";
  const rawAllowed = rows[SYSTEM_CONFIG_KEYS.feishuAllowedOpenIds];
  return {
    appId,
    appSecret,
    allowedOpenIds:
      rawAllowed !== undefined ? parseOpenIds(rawAllowed) : (envFallback?.allowedOpenIds ?? []),
    approvalChatId:
      rows[SYSTEM_CONFIG_KEYS.feishuApprovalChatId] ?? envFallback?.approvalChatId,
    collabChatId:
      rows[SYSTEM_CONFIG_KEYS.feishuCollabChatId] ?? envFallback?.collabChatId,
  };
}


/** 免登端点轻量限流(内存固定窗口):code 由飞书签发且一次性,爆破无收益,
 * 限流仅防公网刷接口放大出站请求;重启清零可接受 */
const FEISHU_LOGIN_RATE = { limit: 30, windowMs: 60_000 };

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(CONSOLE_PASSWORD_MIN_LENGTH),
});

const feishuLoginSchema = z.object({ code: z.string().trim().min(8).max(256) });

function createFeishuRateGuard(): (ip: string) => boolean {
  const map = new Map<string, { count: number; resetAt: number }>();
  return (ip) => {
    const nowMs = Date.now();
    if (map.size > 1000) {
      for (const [key, entry] of map) {
        if (entry.resetAt <= nowMs) {
          map.delete(key);
        }
      }
    }
    const entry = map.get(ip);
    if (entry === undefined || entry.resetAt <= nowMs) {
      map.set(ip, { count: 1, resetAt: nowMs + FEISHU_LOGIN_RATE.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= FEISHU_LOGIN_RATE.limit;
  };
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const lockout = createLoginLockoutGuard({ db, now });
  const feishuRateAllow = createFeishuRateGuard();

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

  app.get("/api/auth/feishu/status", async () => {
    const feishu = await resolveFeishuRuntime(db, options.feishu);
    if (feishu === undefined || feishu.allowedOpenIds.length === 0) {
      return { enabled: false, appId: "" };
    }
    return { enabled: true, appId: feishu.appId };
  });

  /**
   * 飞书免登:code 兑 open_id → 白名单校验 → 会话。信任源复用 FEISHU_ALLOWED_OPEN_IDS
   * (与 bot 入站指令同一 fail-closed 白名单,单管理员下信任域等同),不在名单一律 401。
   * 免登不走口令锁定表——code 一次性、由飞书签发,失败不是口令爆破面。
   */
  app.post("/api/auth/feishu/login", async (request, reply) => {
    if (!feishuRateAllow(request.ip)) {
      return reply.code(429).send({
        error: { code: "RATE_LIMITED", message: "请求过于频繁,请稍后再试" },
      });
    }
    const parsed = feishuLoginSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalidSchema(reply, parsed.error);
    }
    const feishu = await resolveFeishuRuntime(db, options.feishu);
    if (feishu === undefined || feishu.allowedOpenIds.length === 0) {
      return reply.code(401).send({
        error: { code: "UNAUTHORIZED", message: "该飞书账号无权登录" },
      });
    }
    let user: FeishuOauthUser;
    try {
      user = await (options.exchangeFeishuCode ?? exchangeFeishuCode)(parsed.data.code, feishu);
    } catch (err) {
      if (err instanceof FeishuOauthError) {
        return domainError(reply, err);
      }
      throw err;
    }
    if (!feishu.allowedOpenIds.includes(user.openId)) {
      request.log.warn({ openId: user.openId, name: user.name }, "飞书免登被拒:不在白名单");
      return reply.code(401).send({
        error: { code: "UNAUTHORIZED", message: "该飞书账号无权登录" },
      });
    }
    request.log.info({ openId: user.openId, name: user.name }, "飞书免登成功");
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
      const revoked = await revokeOtherSessions(db, currentSessionId);
      return { ok: true, revokedSessions: revoked };
    },
  );
}
