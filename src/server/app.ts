import { readFileSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import type { TeleportAdapter } from "../adapters/teleport/tctl.js";
import type { FeishuConfig } from "../config/env.js";
import { createA2aService } from "../domain/a2a/service.js";
import type { A2aService } from "../domain/a2a/types.js";
import { createCapabilityService, type CapabilityService } from "../domain/capability/service.js";
import type { KnowledgeEntryService } from "../domain/knowledge/entry-service.js";
import type { KnowledgeIndexService } from "../domain/knowledge/index-service.js";
import type { KnowledgeRebuilder } from "../domain/knowledge/rebuild.js";
import { createTaskService } from "../domain/task/service.js";
import { createUsageResolver, type UsageResolver } from "../domain/usage/state.js";
import { createIngestService } from "../domain/work/ingest-service.js";
import { createWorkerService } from "../domain/work/worker-service.js";
import { createConsoleTools } from "../mcp/console-tools.js";
import { healthPayload, type DatabaseStatus } from "../shared/health.js";
import type { Db } from "../store/database.js";
import { requireAllowedHost } from "./middleware/host.js";
import { requireConsoleReadiness } from "./middleware/bootstrap-mode.js";
import { createApprovalNotifier } from "./notification/approval.js";
import { registerA2aRoutes } from "./routes/a2a.js";
import { registerAgentDetailRoutes } from "./routes/agent-detail.js";
import { registerAgentEnrollRoutes } from "./routes/agent-enroll.js";
import { registerAgentKitRoutes } from "./routes/agent-kit.js";
import { registerAgentLifecycleRoutes } from "./routes/agent-lifecycle.js";
import { registerAgentPeersRoutes } from "./routes/agent-peers.js";
import { registerAgentSelfRoutes } from "./routes/agent-self.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerArtifactRoutes } from "./routes/artifacts.js";
import { registerAwNodeRoutes } from "./routes/aw-node.js";
import { registerBootstrapRoutes } from "./routes/bootstrap.js";
import { registerCapabilityRoutes } from "./routes/capabilities.js";
import { registerIdentityRoutes } from "./routes/identity.js";
import { registerIngestRoutes } from "./routes/ingest.js";
import { registerKnowledgeRoutes } from "./routes/knowledge.js";
import { registerMachineRoutes } from "./routes/machine.js";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerOverviewRoutes } from "./routes/overview.js";
import { registerInstallScriptRoute, registerWebRoutes } from "./routes/static.js";
import { registerStreamRoutes } from "./routes/stream.js";
import { registerTaskA2aRoutes } from "./routes/task-a2a.js";
import { registerTaskReadRoutes } from "./routes/task-read.js";
import { registerTaskRoutes } from "./routes/task.js";
import { registerWebhookGithubRoutes } from "./routes/webhook-github.js";
import { registerWorkRoutes } from "./routes/work.js";

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
  /** 知识索引重建器;注入才注册重建接口(内存库无法跨线程共享) */
  knowledgeRebuilder?: KnowledgeRebuilder;
  /** 单条索引重试;缺省时只开放整库重建 */
  knowledgeIndexer?: KnowledgeIndexService;
  /** 知识列表 / 详情 / 编辑 / 采纳;缺省时只开放索引重建 */
  knowledgeEntries?: KnowledgeEntryService;
  /** 飞书配置存在且带 approvalChatId 时,申请落库后推送审批卡片 */
  feishu?: FeishuConfig;
  /** GitHub Webhook 验签密钥;注入才注册 /api/webhooks/github */
  githubWebhookSecret?: string;
  /** 知识目录(kb_write 的 Markdown 真相源);注入才注册远程 MCP `/mcp` */
  knowledgeDir?: string;
  /** 执行面安装脚本路径;存在时按 /artifacts/install.sh 匿名直读(新机器一键安装的取件口) */
  installScriptPath?: string;
  /** 执行面产物镜像目录(aw-node 二进制 + checksums.txt);存在时按 /artifacts/:name 匿名直读 */
  artifactDir?: string;
  /** 对外可达的控制台地址;供站点展示给别的机器复制的下载地址 */
  publicUrl?: string;
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

  if (options.db !== undefined) {
    // bootstrap mode 门控先于一切业务路由:无凭据时只放行 /healthz、bootstrap、enroll 与静态资源
    app.addHook("onRequest", requireConsoleReadiness(options.db));
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
    const collab =
      options.feishu?.collabChatId === undefined
        ? {}
        : { collabChatId: options.feishu.collabChatId };
    const usageResolver: UsageResolver = createUsageResolver(timing);
    // A2A 服务全局一份:HTTP 路由、/mcp 与死信回执唤醒长轮询必须共用同一实例
    const a2aService: A2aService = options.a2a ?? createA2aService({ db, now: options.now ?? Date.now });

    registerAuthRoutes(app, { db, ...timing });
    registerAuditRoutes(app, { db, ...timing });
    registerIdentityRoutes(app, { db, ...timing });
    registerMachineRoutes(app, { db, ...timing });
    registerAgentLifecycleRoutes(app, { db, ...timing });
    registerAgentDetailRoutes(app, { db, ...timing });
    registerAgentSelfRoutes(app, { db, ...timing });
    // Agent 自助接入面:换密钥与查可委派目标都不依赖 MCP,也不依赖工具注册表
    registerAgentEnrollRoutes(app, { db, ...timing });
    registerAgentPeersRoutes(app, { db, ...timing });
    registerOverviewRoutes(app, { db, ...timing });
    registerBootstrapRoutes(app, {
      db,
      ...timing,
      ...(options.artifactDir === undefined ? {} : { artifactDir: options.artifactDir }),
      ...(options.publicUrl === undefined ? {} : { publicUrl: options.publicUrl }),
    });
    registerAwNodeRoutes(app, { db, ...timing });
    registerTaskRoutes(app, { db, ...timing, ...collab });
    registerTaskReadRoutes(app, { db, ...timing });
    registerTaskA2aRoutes(app, { db, ...timing });
    registerWorkRoutes(app, { db, ...timing, ...collab, usageResolver });
    registerStreamRoutes(app, { db, ...timing });
    registerIngestRoutes(app, { db, ...timing });
    if (options.githubWebhookSecret !== undefined) {
      registerWebhookGithubRoutes(app, {
        db,
        ...timing,
        ...collab,
        webhookSecret: options.githubWebhookSecret,
        usageResolver,
      });
    }
    if (options.knowledgeRebuilder !== undefined) {
      registerKnowledgeRoutes(app, {
        db,
        rebuilder: options.knowledgeRebuilder,
        ...(options.knowledgeIndexer === undefined
          ? {}
          : { indexer: options.knowledgeIndexer }),
        ...(options.knowledgeEntries === undefined
          ? {}
          : { entries: options.knowledgeEntries }),
        ...timing,
      });
    }
    registerA2aRoutes(app, {
      db,
      ...timing,
      ...collab,
      service: a2aService,
    });

    // 远程 MCP 与业务 API 共进程同鉴权(arch01 §5.2);kb_write 需要知识目录,未注入不注册。
    // Agent 接入材料与 /mcp 同生共死:它的速查表就是这份工具注册表的投影
    if (options.knowledgeDir !== undefined) {
      // 工具注册表只构造一次:/mcp 与 Agent 手册的速查表共用同一份,工具改了表跟着改
      const consoleTools = createConsoleTools({
        db,
        tasks: createTaskService({ db, now: options.now ?? Date.now }),
        a2a: a2aService,
        workers: createWorkerService({ db, now: options.now ?? Date.now, ...collab }),
        ingest: createIngestService({ db, now: options.now ?? Date.now, ...collab }).ingest,
        ...timing,
        knowledgeDir: options.knowledgeDir,
        announce: {
          db,
          ...(options.feishu?.collabChatId === undefined
            ? {}
            : { chatId: options.feishu.collabChatId }),
          ...timing,
        },
      });
      registerMcpRoutes(app, { db, tools: consoleTools, ...timing, ...collab });
      registerAgentKitRoutes(app, {
        db,
        tools: consoleTools,
        ...timing,
        ...(options.publicUrl === undefined ? {} : { publicUrl: options.publicUrl }),
      });
    }

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

  if (options.installScriptPath !== undefined) {
    registerInstallScriptRoute(app, options.installScriptPath);
  }
  if (options.artifactDir !== undefined) {
    registerArtifactRoutes(app, options.artifactDir);
  }
  if (options.webRoot !== undefined) {
    registerWebRoutes(app, options.webRoot);
  }

  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({ error: { code: "NOT_FOUND", message: "not found" } });
  });

  return app;
}
