import { readFileSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import type { TeleportAdapter } from "../adapters/teleport/tctl.js";
import type { FeishuConfig } from "../config/env.js";
import type { A2aService } from "../domain/a2a/types.js";
import { createCapabilityService, type CapabilityService } from "../domain/capability/service.js";
import { healthPayload, type DatabaseStatus } from "../shared/health.js";
import type { Db } from "../store/database.js";
import { requireAllowedHost } from "./middleware/host.js";
import { createApprovalNotifier } from "./notification/approval.js";
import { registerA2aRoutes } from "./routes/a2a.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCapabilityRoutes } from "./routes/capabilities.js";
import { registerIdentityRoutes } from "./routes/identity.js";
import { registerIngestRoutes } from "./routes/ingest.js";
import { registerOverviewRoutes } from "./routes/overview.js";
import { registerWebRoutes } from "./routes/static.js";
import { registerStreamRoutes } from "./routes/stream.js";
import { registerTaskA2aRoutes } from "./routes/task-a2a.js";
import { registerTaskReadRoutes } from "./routes/task-read.js";
import { registerTaskRoutes } from "./routes/task.js";

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
  /** 由启动方复用的授权服务;缺省时按 db + teleport 新建 */
  service?: CapabilityService;
  /** 由启动方复用的 A2A 服务;死信回执要经同一实例唤醒长轮询 */
  a2a?: A2aService;
  /** 飞书配置存在且带 approvalChatId 时,申请落库后推送审批卡片 */
  feishu?: FeishuConfig;
  /** 前端构建产物目录;存在 index.html 时才注册静态托管与 SPA 回退 */
  webRoot?: string;
  /** 来源白名单(只校验 Host);未注入时不做限制,供路由层测试使用 */
  allowedHosts?: readonly string[];
  now?: () => number;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const startedAt = options.startedAt ?? Date.now();
  const databaseStatus = options.databaseStatus ?? (() => "ok" as const);
  const app = Fastify({ logger: { level: options.logLevel ?? "info" } });

  if (options.allowedHosts !== undefined) {
    app.addHook("onRequest", requireAllowedHost(options.allowedHosts));
  }

  app.get("/healthz", (_request, reply) => {
    const db = databaseStatus();
    return reply
      .code(db === "ok" ? 200 : 503)
      .send(healthPayload(readVersion(), startedAt, db));
  });

  if (options.db !== undefined) {
    const db = options.db;
    const timing = options.now === undefined ? {} : { now: options.now };

    registerAuthRoutes(app, { db, ...timing });
    registerAuditRoutes(app, { db, ...timing });
    registerIdentityRoutes(app, { db, ...timing });
    registerOverviewRoutes(app, { db, ...timing });
    registerTaskRoutes(app, { db, ...timing });
    registerTaskReadRoutes(app, { db, ...timing });
    registerTaskA2aRoutes(app, { db, ...timing });
    registerStreamRoutes(app, { db, ...timing });
    registerIngestRoutes(app, { db, ...timing });
    registerA2aRoutes(app, {
      db,
      ...timing,
      ...(options.a2a === undefined ? {} : { service: options.a2a }),
    });

    // 授权路由依赖 Teleport 适配器;身份 / A2A / 审计只要库
    if (options.teleport !== undefined) {
      const service =
        options.service ?? createCapabilityService({ db, teleport: options.teleport, ...timing });
      const notify = createApprovalNotifier({
        db,
        approvalChatId: options.feishu?.approvalChatId,
        ...timing,
      });

      registerCapabilityRoutes(app, {
        db,
        teleport: options.teleport,
        service,
        ...timing,
        ...(notify === undefined ? {} : { onRequested: notify }),
      });
    }
  }

  if (options.webRoot !== undefined) {
    registerWebRoutes(app, options.webRoot);
  }

  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({ error: { code: "NOT_FOUND", message: "not found" } });
  });

  return app;
}
