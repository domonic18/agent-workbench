import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  completeBootstrap,
  DEFAULT_BUG_FIX,
  runPreflight,
} from "../../domain/bootstrap/assembly.js";
import { findAssembly } from "../../store/repositories/assembly.js";
import {
  consumeOneTimeToken,
  issueOneTimeToken,
  peekOneTimeToken,
} from "../../domain/bootstrap/one-time-token.js";
import { confirmAgents, KEY_PATTERN } from "../../domain/bootstrap/config-delivery.js";
import { listDiscoveryForConsole } from "../../domain/bootstrap/discovery.js";
import { BootstrapError } from "../../domain/bootstrap/errors.js";
import { ONE_TIME_TOKEN } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { hasConsoleCredential, MIN_PASSWORD_LENGTH, setConsolePassword } from "../credential.js";
import {
  requireCsrf,
  requireIdempotencyKey,
  requireSession,
  sessionCookie,
  startSession,
} from "../middleware/session.js";
import { domainError, invalid, invalidSchema } from "./http.js";

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
  now?: () => number;
}

interface AdminBody {
  token?: unknown;
  password?: unknown;
}

function bearerToken(header: unknown): string | undefined {
  if (typeof header !== "string") {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

/** 初始化阶段:/setup 据此决定强制路由(01 §2);装配完成才算 ready(03 §4.0) */
async function phaseOf(
  db: Db,
  machines: number,
  agents: number,
): Promise<"awaiting_machine" | "awaiting_agents" | "awaiting_completion" | "ready"> {
  if (machines === 0) {
    return "awaiting_machine";
  }
  if (agents === 0) {
    return "awaiting_agents";
  }
  return (await findAssembly(db)) === undefined ? "awaiting_completion" : "ready";
}

function nextHint(phase: string): string {
  if (phase === "awaiting_machine") {
    return "添加执行机:签发 enroll token 并在目标机执行安装命令";
  }
  if (phase === "awaiting_agents") {
    return "确认项目与主责 Agent";
  }
  return phase === "awaiting_completion"
    ? "核对默认 bug_fix 装配摘要,完成第 4 步初始化"
    : "初始化完成";
}

export function registerBootstrapRoutes(app: FastifyInstance, options: BootstrapRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;

  app.post("/api/bootstrap/admin", async (request, reply) => {
    const body = (request.body ?? {}) as AdminBody;
    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (token === "" || password === "") {
      return reply.code(422).send({
        error: { code: "VALIDATION_FAILED", message: "token 与 password 必填" },
      });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return reply.code(422).send({
        error: { code: "VALIDATION_FAILED", message: `口令至少 ${MIN_PASSWORD_LENGTH} 位` },
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
      // 分段鉴权:初始化前凭一次性 bootstrap_admin token(只读校验,不消费)
      const token = bearerToken(request.headers.authorization);
      if (token === undefined) {
        return reply.code(401).send({
          error: { code: "UNAUTHORIZED", message: "未初始化,需携带 bootstrap token" },
        });
      }
      const { usable } = await peekOneTimeToken(db, {
        purpose: "bootstrap_admin",
        token,
        now,
      });
      if (!usable) {
        return reply.code(401).send({
          error: { code: "UNAUTHORIZED", message: "bootstrap token 无效或已失效" },
        });
      }
      return { phase: "awaiting_admin", machines: 0, agents: 0, next: "输入 bootstrap token 并设置管理员口令" };
    }
    const guard = requireSession(db, now)(request, reply);
    const rejected = await guard;
    if (rejected !== undefined) {
      return rejected;
    }
    const machines = (
      (await db.get("SELECT COUNT(*)::int AS n FROM machine")) as { n: number }
    ).n;
    const agents = (
      (await db.get("SELECT COUNT(*)::int AS n FROM agent")) as { n: number }
    ).n;
    const phase = await phaseOf(db, machines, agents);
    const assembly = await findAssembly(db);
    return {
      phase,
      machines,
      agents,
      assembly:
        assembly === undefined
          ? null
          : {
              primaryAgentId: assembly.primaryAgentId,
              workKind: assembly.workKind,
              assembledAt: assembly.assembledAt,
            },
      // 默认 bug_fix 摘要:/setup 第 4 步在确认前就要展示,装配定义随源码版本化
      definition: DEFAULT_BUG_FIX,
      next: nextHint(phase),
    };
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