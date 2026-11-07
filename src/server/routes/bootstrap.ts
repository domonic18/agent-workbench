import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  completeBootstrap,
  runPreflight,
} from "../../domain/bootstrap/assembly.js";
import { createBootstrapStatusService } from "../../domain/bootstrap/status.js";
import {
  consumeOneTimeToken,
  issueOneTimeToken,
} from "../../domain/bootstrap/one-time-token.js";
import {
  confirmAgents,
  requestBotNameRefresh,
  KEY_PATTERN,
} from "../../domain/bootstrap/config-delivery.js";
import { listDiscoveryForConsole } from "../../domain/bootstrap/discovery.js";
import { BootstrapError } from "../../domain/bootstrap/errors.js";
import { CONSOLE_PASSWORD_MIN_LENGTH, ONE_TIME_TOKEN } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { hasConsoleCredential, setConsolePassword } from "../credential.js";
import {
  requireCsrf,
  requireIdempotencyKey,
  requireSession,
  sessionCookie,
  startSession,
} from "../middleware/session.js";
import { domainError, invalid, invalidSchema } from "./http.js";
import { listArtifacts } from "./artifacts.js";

const confirmSchema = z.object({
  machineId: z.string().min(1),
  agents: z
    .array(
      z.object({
        project: z.string().min(1).max(200),
        displayName: z.string().min(1).max(200).optional(),
        key: z.string().regex(KEY_PATTERN).optional(),
      }),
    )
    .min(1)
    .max(50),
});

export interface BootstrapRoutesOptions {
  db: Db;
  /** 执行面产物镜像目录;存在时 /api/bootstrap/artifacts 列出可下载地址 */
  artifactDir?: string;
  /** 对外可达的控制台地址;站点据此给出可复制的下载地址 */
  publicUrl?: string;
  now?: () => number;
}

interface AdminBody {
  token?: unknown;
  password?: unknown;
}

export function registerBootstrapRoutes(app: FastifyInstance, options: BootstrapRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const statusService = createBootstrapStatusService({ db });

  app.post("/api/bootstrap/admin", async (request, reply) => {
    const body = (request.body ?? {}) as AdminBody;
    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (token === "" || password === "") {
      return reply.code(422).send({
        error: { code: "VALIDATION_FAILED", message: "token 与 password 必填" },
      });
    }
    if (password.length < CONSOLE_PASSWORD_MIN_LENGTH) {
      return reply.code(422).send({
        error: { code: "VALIDATION_FAILED", message: `口令至少 ${CONSOLE_PASSWORD_MIN_LENGTH} 位` },
      });
    }
    // 先消费令牌再查管理员:重放/过期一律按令牌语义 410,不泄漏初始化状态
    const consumed = await consumeOneTimeToken(db, {
      purpose: "bootstrap_admin",
      token,
      now,
    });
    if (!consumed.ok) {
      return reply
        .code(consumed.reason === "invalid" ? 401 : 410)
        .send({ error: { code: "UNAUTHORIZED", message: "bootstrap token 无效或已失效" } });
    }
    if (await hasConsoleCredential(db)) {
      return reply.code(409).send({
        error: { code: "CONFLICT", message: "管理员已初始化,请直接登录" },
      });
    }
    try {
      await setConsolePassword(db, password);
    } catch {
      return reply.code(409).send({
        error: { code: "CONFLICT", message: "管理员已初始化,请直接登录" },
      });
    }
    const { id, expiresAt } = await startSession(db, now);
    reply.header("set-cookie", sessionCookie(id));
    return { ok: true, expiresAt };
  });

  app.get("/api/bootstrap/status", async (request, reply) => {
    if (!(await hasConsoleCredential(db))) {
      // 初始化前匿名可读:只暴露 awaiting_admin 相位,不含业务数据。
      // SPA 必须先拿到相位才能把用户路由进 /setup;若此处返回 401,
      // 前端会把任何 401 统一弹回登录页,形成初始化死循环。
      return {
        phase: "awaiting_admin",
        machines: 0,
        agents: 0,
        next: "输入 bootstrap token 并设置管理员口令",
      };
    }
    const guard = requireSession(db, now)(request, reply);
    const rejected = await guard;
    if (rejected !== undefined) {
      return rejected;
    }
    return statusService.getStatus();
  });

  app.get("/api/bootstrap/artifacts", async () => {
    // 匿名可读:只暴露公开产物名、大小与校验和,不含任何凭据
    const assets =
      options.artifactDir === undefined ? [] : listArtifacts(options.artifactDir);
    return { publicUrl: options.publicUrl ?? null, assets };
  });

  app.post(
    "/api/bootstrap/enroll-token",
    { preHandler: [requireSession(db, now), requireCsrf(), requireIdempotencyKey()] },
    async (_request, reply) => {
      const issued = await issueOneTimeToken(db, {
        purpose: "enroll",
        ttlMs: ONE_TIME_TOKEN.enrollTtlMs,
        now,
      });
      return reply.code(201).send({ token: issued.token, expiresAt: issued.expiresAt });
    },
  );

  app.get("/api/bootstrap/discovery", { preHandler: [requireSession(db, now)] }, async () => {
    return { machines: await listDiscoveryForConsole(db) };
  });

  app.post(
    "/api/bootstrap/agents",
    { preHandler: [requireSession(db, now), requireCsrf(), requireIdempotencyKey()] },
    async (request, reply) => {
      const parsed = confirmSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidSchema(reply, parsed.error);
      }
      if (parsed.data.agents.length === 0) {
        return invalid(reply, "至少确认一个 Agent");
      }
      try {
        const created = await confirmAgents(
          { db, now },
          { machineId: parsed.data.machineId, entries: parsed.data.agents },
        );
        return reply.code(201).send({ agents: created });
      } catch (error) {
        if (error instanceof BootstrapError) {
          return domainError(reply, error);
        }
        throw error;
      }
    },
  );

  app.post(
    "/api/bootstrap/refresh-bot-names",
    { preHandler: [requireSession(db, now), requireCsrf(), requireIdempotencyKey()] },
    async (request, reply) => {
      const body = (request.body ?? {}) as { machineId?: unknown };
      const machineId = typeof body.machineId === "string" ? body.machineId : "";
      if (machineId === "") {
        return invalid(reply, "machineId 必填");
      }
      try {
        await requestBotNameRefresh({ db, now }, machineId);
        return reply.code(202).send({ ok: true });
      } catch (error) {
        if (error instanceof BootstrapError) {
          return domainError(reply, error);
        }
        throw error;
      }
    },
  );

  app.post("/api/bootstrap/preflight", { preHandler: [requireSession(db, now)] }, async () => {
    return runPreflight({ db, now });
  });

  app.post(
    "/api/bootstrap/complete",
    { preHandler: [requireSession(db, now), requireCsrf(), requireIdempotencyKey()] },
    async (request, reply) => {
      const body = (request.body ?? {}) as { primaryAgentId?: unknown };
      const primaryAgentId = typeof body.primaryAgentId === "string" ? body.primaryAgentId : "";
      if (primaryAgentId === "") {
        return invalid(reply, "primaryAgentId 必填");
      }
      try {
        const result = await completeBootstrap({ db, now }, { primaryAgentId });
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof BootstrapError) {
          return domainError(reply, error);
        }
        throw error;
      }
    },
  );

}