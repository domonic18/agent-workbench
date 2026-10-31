import { readFileSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import type { TeleportAdapter } from "../adapters/teleport/tctl.js";
import { healthPayload, type DatabaseStatus } from "../shared/health.js";
import type { Db } from "../store/database.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCapabilityRoutes } from "./routes/capabilities.js";

// dist/server 与 src/server 到仓库根同为两级,容器内亦然
function readVersion(): string {
  const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
  return (JSON.parse(raw) as { version: string }).version;
}

export interface BuildAppOptions {
  startedAt?: number;
  logLevel?: string;
  /** 由启动方注入;未注入视为「无库依赖」,仅用于路由层测试 */
  databaseStatus?: () => DatabaseStatus;
  /** 注入 db + teleport 才注册需要状态的业务路由;缺省时只有 /healthz */
  db?: Db;
  teleport?: TeleportAdapter;
  now?: () => number;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const startedAt = options.startedAt ?? Date.now();
  const databaseStatus = options.databaseStatus ?? (() => "ok" as const);
  const app = Fastify({ logger: { level: options.logLevel ?? "info" } });

  app.get("/healthz", (_request, reply) => {
    const db = databaseStatus();
    return reply
      .code(db === "ok" ? 200 : 503)
      .send(healthPayload(readVersion(), startedAt, db));
  });

  if (options.db !== undefined && options.teleport !== undefined) {
    const timing = options.now === undefined ? {} : { now: options.now };
    registerAuthRoutes(app, { db: options.db, ...timing });
    registerCapabilityRoutes(app, { db: options.db, teleport: options.teleport, ...timing });
  }

  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({ error: { code: "NOT_FOUND", message: "not found" } });
  });

  return app;
}
