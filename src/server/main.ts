import { dirname, join } from "node:path";
import * as Lark from "@larksuiteoapi/node-sdk";
import { createCardSender } from "../adapters/feishu/card.js";
import { startFeishuInbound, type FeishuInbound } from "../adapters/feishu/client.js";
import { createProcessRunner } from "../adapters/teleport/process-runner.js";
import { createTeleportAdapter } from "../adapters/teleport/tctl.js";
import { loadConfig } from "../config/env.js";
import { createCapabilityService } from "../domain/capability/service.js";
import { isDatabaseWritable, openDatabase } from "../store/database.js";
import { acquireInstanceLock } from "../store/lock.js";
import { runMigrations } from "../store/migrator.js";
import { buildApp } from "./app.js";
import { ensureConsoleCredential } from "./credential.js";
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

const app = buildApp({
  logLevel: config.logLevel,
  databaseStatus: () => (isDatabaseWritable(db) ? "ok" : "unavailable"),
  db,
  teleport,
  service,
  ...(config.feishu === undefined ? {} : { feishu: config.feishu }),
});

const reconciler = startCapabilityReconciler(service, app.log);

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
