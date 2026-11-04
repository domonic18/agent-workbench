import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";

describe("openDatabase", () => {
  it("建独立 PG 库并完成迁移,可执行查询", async () => {
    const db = await openDatabase();

    expect(await db.get("SELECT 1 AS ok")).toEqual({ ok: 1 });
    expect(await db.get("SELECT COUNT(*) AS n FROM schema_migration")).toEqual({ n: 4 });
    await db.close();
  });

  it("每个句柄使用独立的随机库,互不可见", async () => {
    const a = await openDatabase();
    const b = await openDatabase();
    await a.run(
      "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m-a', 'h', 'linux', '1', 'h', 'active', 0)",
    );

    expect(await a.get("SELECT COUNT(*) AS n FROM machine")).toEqual({ n: 1 });
    expect(await b.get("SELECT COUNT(*) AS n FROM machine")).toEqual({ n: 0 });
    await a.close();
    await b.close();
  });
});
