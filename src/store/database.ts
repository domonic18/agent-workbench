import { readFileSync } from "node:fs";
import { join } from "node:path";
// pg 是 CommonJS 模块:值经默认导入解构,类型仍用具名 type 导入(编译期擦除)
import pg from "pg";
import type { Pool as PgPool, PoolClient, QueryResult } from "pg";

const { Pool, types } = pg;
type Pool = PgPool;

/**
 * PostgreSQL 事务域句柄(2026-11-03 重基线,02 §1)。
 * 同一接口覆盖「连接池」与「事务内客户端」两种形态:仓储函数只认 `db: Db`,
 * 事务由 `db.transaction(async (tx) => ...)` 提供,回调内以 `tx` 传入仓储,
 * 保证同事务的语句走同一连接。
 *
 * 占位符沿用仓库既有的 `?` 写法,由本适配器翻译为 `$n`;SQL 文本保持原样,
 * 方言差异(`json_valid`/`strftime`/`INSERT OR IGNORE`)在迁移与仓储落 PG 方言。
 */
export interface Db {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
  /** 取第一行;无行返回 undefined。等价旧 better-sqlite3 的 `get`(变参绑定) */
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  /** 写语句;`changes` 取 affected rows,供 CAS(`changes === 1`)判定 */
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  /** 多语句脚本(迁移用),不带参数,走 simple query 协议 */
  exec(sql: string): Promise<void>;
  /** 事务:专用连接 BEGIN/COMMIT,异常 ROLLBACK 并向上抛 */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** SQLite 风格 `?` 占位符 → PostgreSQL `$1..$n`。语句文本不改,仓储零改动 */
export function toPgPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
}

function rowCountOf(result: QueryResult): number {
  return result.rowCount ?? 0;
}

class PgHandle implements Db {
  constructor(
    private readonly source: Pool | PoolClient,
    private readonly onClose: () => Promise<void>,
  ) {}

  query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    if (params.length === 0) {
      // 无参数语句走 simple 协议,允许多语句(迁移脚本依赖)
      return this.source.query(toPgPlaceholders(sql));
    }
    return this.source.query(toPgPlaceholders(sql), params);
  }

  async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    const result = await this.query(sql, params);
    return result.rows[0] as T | undefined;
  }

  async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    const result = await this.query(sql, params);
    return result.rows as T[];
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    const result = await this.query(sql, params);
    return { changes: rowCountOf(result) };
  }

  async exec(sql: string): Promise<void> {
    await this.query(sql);
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (this.source instanceof Pool) {
      const client = await this.source.connect();
      const tx = new PgHandle(client, async () => client.release());
      try {
        await client.query("BEGIN");
        const value = await fn(tx);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    // 事务内再开事务:PostgreSQL 无嵌套事务,直接复用当前连接;外层 COMMIT 统一收口
    return fn(this);
  }

  async close(): Promise<void> {
    await this.onClose();
  }
}

// int8(oid 20)→number:epoch ms 与自增 id 语义均为 number,不接受字符串
types.setTypeParser(20, (value: string) => Number.parseInt(value, 10));

export type { QueryResult };

/** 生产连接池。连接串来自 DATABASE_URL(env),池大小按单机部署默认 10 */
export function createDb(connectionString: string, poolSize = 10): Db {
  const pool = new Pool({ connectionString, max: poolSize });
  return new PgHandle(pool, async () => {
    await pool.end();
  });
}

/**
 * 测试基座:独立 PG 库(名称随机,库间零残留)。close() 同时落库销毁。
 * 迁移由调用方在本句柄上执行(与生产同一 migrator,行为契约一致)。
 */
export async function createTestDatabase(adminUrl: string): Promise<Db> {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const name = `aw_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = `${adminUrl.split("/").slice(0, -1).join("/")}/${name}`;
  const pool = new Pool({ connectionString: url, max: 5 });
  const handle = new PgHandle(pool, async () => {
    await pool.end();
    const cleaner = new Pool({ connectionString: adminUrl, max: 1 });
    await cleaner.query(`DROP DATABASE IF EXISTS ${name}`);
    await cleaner.end();
  });
  return handle;
}

const DEFAULT_TEST_PG_URL = "postgres://agent_workbench@127.0.0.1:5433/agent_workbench";

/** 测试口令从 docker/.env(仓库根向上查找)读取;compose 的 postgres 在 127.0.0.1:5433 */
export function resolveTestAdminUrl(): string {
  let dir = process.cwd();
  for (let i = 0; i < 4; i += 1) {
    try {
      const text = readFileSync(join(dir, "docker/.env"), "utf8");
      const match = /POSTGRES_PASSWORD=(.*)/.exec(text);
      const password = match?.[1]?.trim();
      if (password !== undefined && password !== "") {
        return `postgres://agent_workbench:${encodeURIComponent(password)}@127.0.0.1:5433/agent_workbench`;
      }
    } catch {
      // 继续向上找
    }
    dir = join(dir, "..");
  }
  return DEFAULT_TEST_PG_URL;
}

/**
 * 测试基座(兼容旧用法的导出名):独立 PG 库 + forward-only 迁移已应用。
 * close() 落库销毁。`path` 参数仅为兼容旧签名,已无意义。
 */
export async function openDatabase(_path?: string): Promise<Db> {
  const handle = await createTestDatabase(resolveTestAdminUrl());
  const { runMigrations } = await import("./migrator.js");
  await runMigrations(handle);
  return handle;
}
