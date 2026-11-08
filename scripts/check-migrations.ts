/**
 * 迁移守卫(CI migration-guard job 用,也可本地直跑):
 * 在空库上从零重放全部迁移,再重放一次断言 0 条新应用——
 * forward-only + checksum 锁(02 §7)下,这是「迁移可安全上线」的最小契约。
 * 单实例部署没有旧版本兜底,迁移失败即控制台停机,这道闸门在 CI 先拦。
 * 连接沿用测试基座:admin 连接串 127.0.0.1:5433,口令从 docker/.env 读取。
 */
import { createTestDatabase, resolveTestAdminUrl } from "../src/store/database.js";
import { defaultMigrationsDir, loadMigrations, runMigrations } from "../src/store/migrator.js";

const db = await createTestDatabase(resolveTestAdminUrl());
try {
  const total = loadMigrations(defaultMigrationsDir()).length;
  const applied = await runMigrations(db);
  if (applied !== total) {
    throw new Error(`从零重放应应用 ${total} 条迁移,实际 ${applied} 条`);
  }
  const replayed = await runMigrations(db);
  if (replayed !== 0) {
    throw new Error(`二次重放应新应用 0 条,实际 ${replayed} 条(违反幂等契约)`);
  }
  console.log(`[OK] ${total} 条迁移:从零重放 + 幂等重放通过`);
} finally {
  await db.close();
}
