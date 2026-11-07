import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Lark from "@larksuiteoapi/node-sdk";
import { createCardSender } from "../adapters/feishu/card.js";
import { startFeishuInbound, type FeishuInbound } from "../adapters/feishu/client.js";
import { createTeleportAuditAdapter } from "../adapters/teleport/audit.js";
import { createProcessRunner } from "../adapters/teleport/process-runner.js";
import { createTeleportAdapter } from "../adapters/teleport/tctl.js";
import { loadConfig } from "../config/env.js";
import { createA2aService } from "../domain/a2a/service.js";
import { issueOneTimeToken } from "../domain/bootstrap/one-time-token.js";
import { createAuditReconciler } from "../domain/capability/audit-reconcile.js";
import { createCapabilityService } from "../domain/capability/service.js";
import { createEmbeddingClient } from "../adapters/embedding/openai.js";
import { createKnowledgeEntryService } from "../domain/knowledge/entry-service.js";
import { createKnowledgeIndexService } from "../domain/knowledge/index-service.js";
import { createKnowledgeRebuilder } from "../domain/knowledge/rebuild.js";
import { validatePolicy } from "../domain/routing/policy.js";
import { ONE_TIME_TOKEN } from "../shared/constants.js";
import { createDb } from "../store/database.js";
import { acquireInstanceLock } from "../store/lock.js";
import { runMigrations } from "../store/migrator.js";
import { buildApp } from "./app.js";
import { ensureConsoleCredential, hasConsoleCredential } from "./credential.js";
import { startAuditReconciler } from "./jobs/audit-reconcile.js";
import { startDeadLetterSweeper } from "./jobs/dead-letter.js";
import { startIngestReceiptCleaner } from "./jobs/ingest-receipt.js";
import { startOutboxReclaimer } from "./jobs/outbox-reclaim.js";
import { startCapabilityReconciler } from "./jobs/reconcile.js";
import { startOutboxSender, type OutboxSender } from "./jobs/send-worker.js";
import { startWorkInboxReclaimer } from "./jobs/work-reclaim.js";

// 启动顺序(01 §2):env → 单实例锁 → 打开库 → 迁移与口令初始化 → 注册路由 → 监听。
// 锁先于开库:第二个进程不能在第一个进程的库上跑迁移。
const config = loadConfig();
const lock = acquireInstanceLock(join(process.cwd(), "console.lock"));
const db = await createDb(config.databaseUrl);

try {
  await runMigrations(db);
  await ensureConsoleCredential(db, config.consoleInitPassword);
  if (!(await hasConsoleCredential(db))) {
    // 无凭据且无种子:进入 bootstrap mode,本机一次性打印 bootstrap_admin token(01 §2)
    const issued = await issueOneTimeToken(db, {
      purpose: "bootstrap_admin",
      ttlMs: ONE_TIME_TOKEN.adminTtlMs,
    });
    console.info(
      `[bootstrap] 控制台无管理员凭据,已进入 bootstrap mode;` +
        `一次性 token(${ONE_TIME_TOKEN.adminTtlMs / 60_000} 分钟内有效,仅本次打印): ${issued.token}`,
    );
  }
} catch (error) {
  await db.close();
  lock.release();
  throw error;
}

const teleport = await createTeleportAdapter(config.teleport, createProcessRunner());
const service = createCapabilityService({ db, teleport });
const a2a = createA2aService({ db });
const knowledgeRebuilder = createKnowledgeRebuilder({
  databaseUrl: config.databaseUrl,
  knowledgeDir: config.knowledgeDir,
  ...(config.embedding === undefined ? {} : { embedding: config.embedding }),
});
const knowledgeEmbedding =
  config.embedding === undefined ? undefined : createEmbeddingClient(config.embedding);
const knowledgeIndexer = await createKnowledgeIndexService({
  db,
  knowledgeDir: config.knowledgeDir,
  ...(knowledgeEmbedding === undefined ? {} : { embedding: knowledgeEmbedding }),
});
const knowledgeEntries = createKnowledgeEntryService({
  db,
  knowledgeDir: config.knowledgeDir,
  indexer: knowledgeIndexer,
});

const app = buildApp({
  logLevel: config.logLevel,
  databaseStatus: () => "ok",
  db,
  teleport,
  service,
  a2a,
  knowledgeDir: config.knowledgeDir,
  knowledgeRebuilder,
  knowledgeIndexer,
  knowledgeEntries,
  allowedHosts: config.allowedHosts,
  // src/server 与 dist/server 到仓库根同为两级目录
  installScriptPath: fileURLToPath(new URL("../../scripts/install-aw-node.sh", import.meta.url)),
  // 执行面产物镜像:宿主机 workspace/artifacts(容器内同路径),缺失时只影响取件口
  artifactDir: fileURLToPath(new URL("../../workspace/artifacts", import.meta.url)),
  webRoot: fileURLToPath(new URL("../../dist/web", import.meta.url)),
  ...(config.publicUrl === undefined ? {} : { publicUrl: config.publicUrl }),
  ...(config.feishu === undefined ? {} : { feishu: config.feishu }),
  ...(config.githubWebhookSecret === undefined
    ? {}
    : { githubWebhookSecret: config.githubWebhookSecret }),
});

// Git 版本化策略校验(01 §9.2):结构错误 fail-fast;引用缺失只告警,派工时再校验
const policyValidation = await validatePolicy({ db, log: app.log });
app.log.info(`work policy 就绪: version=${policyValidation.version}`);

const reconciler = startCapabilityReconciler(service, app.log);

// 租约回收独立于 push worker:未配置飞书时 pull 通道的过期租约同样要回收
const outboxReclaimer = startOutboxReclaimer(db, app.log);

// worker_inbox 过期租约回收(01 §10):只改状态不建行,重投不重复建 Task
const workInboxReclaimer = startWorkInboxReclaimer(db, app.log);

// 死信巡检(01 §9):复用路由的 A2A 实例,回执落库后能直接唤醒发起方的长轮询
const deadLetters = startDeadLetterSweeper(db, app.log, {
  wake: (agentId) => a2a.wake(agentId),
});

// 采集去重回执按 7 天窗口滚动清理;窗口外的旧 seq 重放交给采集器重发
const ingestReceipts = startIngestReceiptCleaner(db, app.log);

// 审计对账(05 §7):配置了 Teleport 审计日志路径才起;未配置只告警,不伪造缺口
const auditReconciler =
  config.teleport.auditLogPath === undefined
    ? undefined
    : startAuditReconciler(
        createAuditReconciler({
          db,
          teleportAudit: createTeleportAuditAdapter({
            auditLogPath: config.teleport.auditLogPath,
          }),
        }),
        app.log,
      );
if (auditReconciler === undefined) {
  app.log.warn("TELEPORT_AUDIT_LOG_PATH 未配置,审计对账作业不启动");
}

// 有飞书凭据才起投递作业;无凭据时发件箱照样可写,待配好凭据后补投
const outbox: OutboxSender | undefined =
  config.feishu === undefined
    ? undefined
    : startOutboxSender(
        db,
        createCardSender(
          new Lark.Client({ appId: config.feishu.appId, appSecret: config.feishu.appSecret }),
        ),
        app.log,
      );

let inbound: FeishuInbound | undefined;
let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  reconciler.stop();
  outboxReclaimer.stop();
  workInboxReclaimer.stop();
  auditReconciler?.stop();
  deadLetters.stop();
  ingestReceipts.stop();
  outbox?.stop();
  inbound?.stop();
  const timer = setTimeout(() => process.exit(1), 10_000);
  timer.unref();
  void app.close().then(
    async () => {
      await db.close();
      lock.release();
      process.exit(0);
    },
    () => {
      process.exit(1);
    },
  );
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ host: config.host, port: config.port });

// 飞书不可用时控制台照常运行(01 §8);只有配置了应用凭据才建立长连接
if (config.feishu !== undefined) {
  if (config.feishu.allowedOpenIds.length === 0) {
    app.log.warn("FEISHU_ALLOWED_OPEN_IDS 为空,所有入站指令都将被回执无权限");
  }
  try {
    inbound = await startFeishuInbound(config.feishu, db, service, app.log);
    app.log.info("飞书长连接已建立,等待消息与卡片事件");
  } catch (error) {
    app.log.error({ err: error }, "飞书长连接启动失败,控制台继续运行");
  }
}
