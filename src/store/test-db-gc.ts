import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

/**
 * 测试库回收（vitest globalSetup）。
 *
 * 每个测试文件各自建库（`aw_test_<base36 毫秒时间戳>_<随机>`），正常路径由
 * `createTestDatabase` 的 close() 落库销毁；但文件中途失败、worker 被回收或
 * DROP 未跑完时，库会留下。残留库不会自己消失，反而越积越多——PG 目录膨胀后
 * CREATE DATABASE 变慢，测试开始超时，失败又生出新残留，形成自激的塌方。
 *
 * 故每次跑测试前先清掉**陈旧**的残留库：只删自己命名里时间戳早于阈值的那批，
 * 避免误删同一时刻并行跑的另一个测试进程正在用的库。
 */

/** 命名与 createTestDatabase 保持一致，改一处必须同步另一处 */
const TEST_DB_PREFIX = "aw_test_";

/** 早于该时长的残留库才算陈旧（毫秒）。默认 1 小时：足够覆盖一次完整跑批 */
const STALE_MS = 60 * 60 * 1000;

function resolveAdminUrl(): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i < 4; i += 1) {
    try {
      const text = readFileSync(join(dir, "docker/.env"), "utf8");
      const password = /POSTGRES_PASSWORD=(.*)/.exec(text)?.[1]?.trim();
      if (password !== undefined && password !== "") {
        return `postgres://agent_workbench:${encodeURIComponent(password)}@127.0.0.1:5433/agent_workbench`;
      }
    } catch {
      // 继续向上找
    }
    dir = join(dir, "..");
  }
  return undefined;
}

/** 从库名里取创建时刻：aw_test_<base36 毫秒时间戳>_<随机> */
function createdAtOf(datname: string): number | undefined {
  const raw = datname.split("_")[2];
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 36);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function setup(): Promise<void> {
  const adminUrl = resolveAdminUrl();
  if (adminUrl === undefined) {
    return;
  }
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    const listed = await pool.query(
      "SELECT datname FROM pg_database WHERE datname LIKE $1",
      [`${TEST_DB_PREFIX}%`],
    );
    const cutoff = Date.now() - STALE_MS;
    const stale = listed.rows
      .map((row) => row.datname as string)
      .filter((name) => {
        const createdAt = createdAtOf(name);
        return createdAt !== undefined && createdAt < cutoff;
      });
    for (const name of stale) {
      try {
        await pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } catch {
        // 单个库删不掉不应阻断测试；留着下次再收
      }
    }
    if (stale.length > 0) {
      console.log(`[test-db-gc] 回收陈旧测试库 ${stale.length} 个`);
    }
  } finally {
    await pool.end();
  }
}

export async function teardown(): Promise<void> {
  // 无需收尾：残留由下一次 setup 回收
}
