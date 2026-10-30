import { readFileSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import { healthPayload, type DatabaseStatus } from "../shared/health.js";

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

  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({ error: { code: "NOT_FOUND", message: "not found" } });
  });

  return app;
}
