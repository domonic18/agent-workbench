import { dirname, join } from "node:path";
import { loadConfig } from "../config/env.js";
import { isDatabaseWritable, openDatabase } from "../store/database.js";
import { acquireInstanceLock } from "../store/lock.js";
import { runMigrations } from "../store/migrator.js";
import { buildApp } from "./app.js";

// 启动顺序(01 §2):env → 单实例锁 → 打开库 → 迁移 → 注册路由 → 监听。
// 锁先于开库:第二个进程不能在第一个进程的库上跑迁移。
const config = loadConfig();
const lock = acquireInstanceLock(join(dirname(config.databasePath), "console.lock"));
const db = openDatabase(config.databasePath);

try {
  runMigrations(db);
} catch (error) {
  db.close();
  lock.release();
  throw error;
}

const app = buildApp({
  logLevel: config.logLevel,
  databaseStatus: () => (isDatabaseWritable(db) ? "ok" : "unavailable"),
});

let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
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
