import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SESSION_TTL_MS } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import {
  createSession,
  deleteSession,
  findActiveSession,
  touchSession,
} from "../../store/repositories/session.js";

export const SESSION_COOKIE = "aw_session";

export type PreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/** Cookie 头只到 `id=value` 这一层;值不含分隔符,不做额外解码 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (header === undefined) {
    return cookies;
  }
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name !== "") {
      cookies[name] = value;
    }
  }
  return cookies;
}

export function sessionCookie(id: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function startSession(db: Db, now: () => number): { id: string; expiresAt: number } {
  const id = randomBytes(32).toString("base64url");
  const createdAt = now();
  const expiresAt = createdAt + SESSION_TTL_MS;
  createSession(db, { id, createdAt, expiresAt });
  return { id, expiresAt };
}

export function sessionIdFrom(request: FastifyRequest): string | undefined {
  return parseCookies(request.headers.cookie)[SESSION_COOKIE];
}

export function endSession(db: Db, id: string): void {
  deleteSession(db, id);
}

/** 未登录 / 过期统一 401,不区分「没带 cookie」与「会话失效」 */
export function requireSession(db: Db, now: () => number): PreHandler {
  return async (request, reply) => {
    const id = sessionIdFrom(request);
    if (id === undefined || findActiveSession(db, id, now()) === undefined) {
      return reply
        .code(401)
        .send({ error: { code: "UNAUTHORIZED", message: "未登录或会话已过期" } });
    }
    touchSession(db, id, now());
    return undefined;
  };
}

/** 非只读请求要求自定义头;带 Origin 时其 host 必须与 Host 一致 */
export function requireCsrf(): PreHandler {
  return async (request, reply) => {
    const method = request.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return undefined;
    }
    if (request.headers["x-requested-with"] === undefined) {
      return reply
        .code(403)
        .send({ error: { code: "FORBIDDEN", message: "缺少 X-Requested-With 头" } });
    }
    const origin = request.headers.origin;
    if (origin !== undefined) {
      let originHost: string | undefined;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = undefined;
      }
      if (originHost !== request.headers.host) {
        return reply
          .code(403)
          .send({ error: { code: "FORBIDDEN", message: "跨站请求被拒绝" } });
      }
    }
    return undefined;
  };
}

export function requireIdempotencyKey(): PreHandler {
  return async (request, reply) => {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.trim() === "") {
      return reply.code(422).send({
        error: { code: "VALIDATION_FAILED", message: "写操作必须携带 Idempotency-Key" },
      });
    }
    return undefined;
  };
}
