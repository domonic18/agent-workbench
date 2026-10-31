import type { FastifyInstance } from "fastify";
import type { Db } from "../../store/database.js";
import { verifyConsolePassword } from "../credential.js";
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

  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body as { password?: unknown } | null;
    const password = typeof body?.password === "string" ? body.password : "";
    if (password === "") {
      return reply.code(422).send({
        error: { code: "VALIDATION_FAILED", message: "请提供口令" },
      });
    }
    if (!verifyConsolePassword(db, password)) {
      return reply.code(401).send({
        error: { code: "UNAUTHORIZED", message: "口令错误" },
      });
    }
    const { id, expiresAt } = startSession(db, now);
    reply.header("set-cookie", sessionCookie(id));
    return { ok: true, expiresAt };
  });

  app.post(
    "/api/auth/logout",
    { preHandler: [requireSession(db, now), requireCsrf()] },
    async (request, reply) => {
      const id = sessionIdFrom(request);
      if (id !== undefined) {
        endSession(db, id);
      }
      reply.header("set-cookie", clearSessionCookie());
      return { ok: true };
    },
  );
}
