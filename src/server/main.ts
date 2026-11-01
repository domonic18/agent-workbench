import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Lark from "@larksuiteoapi/node-sdk";
import { createCardSender } from "../adapters/feishu/card.js";
import { startFeishuInbound, type FeishuInbound } from "../adapters/feishu/client.js";
import { createTeleportAuditAdapter } from "../adapters/teleport/audit.js";
import { createProcessRunner } from "../adapters/teleport/process-runner.js";
import { createTeleportAdapter } from "../adapters/teleport/tctl.js";
import { loadConfig } from "../config/env.js";
import { createA2aService } from "../domain/a2a/service.js";
import { createAuditReconciler } from "../domain/capability/audit-reconcile.js";
import { createCapabilityService } from "../domain/capability/service.js";
import { isDatabaseWritable, openDatabase } from "../store/database.js";
import { acquireInstanceLock } from "../store/lock.js";
import { runMigrations } from "../store/migrator.js";
import { buildApp } from "./app.js";
import { ensureConsoleCredential } from "./credential.js";
import { startAuditReconciler } from "./jobs/audit-reconcile.js";
import { startDeadLetterSweeper } from "./jobs/dead-letter.js";
import { startIngestReceiptCleaner } from "./jobs/ingest-receipt.js";
import { startCapabilityReconciler } from "./jobs/reconcile.js";
import { startOutboxSender, type OutboxSender } from "./jobs/send-worker.js";

// 启动顺序(01 §2):env → 单实例锁 → 打开库 → 迁移与口令初始化 → 注册路由 → 监听。
// 锁先于开库:第二个进程不能在第一个进程的库上跑迁移。
const config = loadConfig();
const lock = acquireInstanceLock(join(dirname(config.databasePath), "console.lock"));
const db = openDatabase(config.databasePath);

try {
  runMigrations(db);
  ensureConsoleCredential(db, config.consoleInitPassword);
} catch (error) {
  db.close();
  lock.release();
  throw error;
}

const teleport = createTeleportAdapter(config.teleport, createProcessRunner());
const service = createCapabilityService({ db, teleport });
const a2a = createA2aService({ db });

const app = buildApp({
  logLevel: config.logLevel,
  databaseStatus: () => (isDatabaseWritable(db) ? "ok" : "unavailable"),
  db,
  teleport,
  service,
  a2a,
  allowedHosts: config.allowedHosts,
  // src/server 与 dist/server 到仓库根同为两级目录
  webRoot: fileURLToPath(new URL("../../dist/web", import.meta.url)),
  ...(config.feishu === undefined ? {} : { feishu: config.feishu }),
});

const reconciler = startCapabilityReconciler(service, app.log);

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
  auditReconciler?.stop();
  deadLetters.stop();
  ingestReceipts.stop();
  outbox?.stop();
  inbound?.stop();
  const timer = setTimeout(() => process.exit(1), 10_000);
  timer.unref();
  void app.close().then(
    () => {
      db.close();
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
