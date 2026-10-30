import { readFileSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import { healthPayload } from "../shared/health.js";

// dist/server 与 src/server 到仓库根同为两级,容器内亦然
function readVersion(): string {
  const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
  return (JSON.parse(raw) as { version: string }).version;
}

export interface BuildAppOptions {
  startedAt?: number;
  logLevel?: string;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const startedAt = options.startedAt ?? Date.now();
  const app = Fastify({ logger: { level: options.logLevel ?? "info" } });

  app.get("/healthz", () => healthPayload(readVersion(), startedAt));

  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({ error: { code: "NOT_FOUND", message: "not found" } });
  });

  return app;
}
