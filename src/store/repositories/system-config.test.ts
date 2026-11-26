import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import {
  readSystemConfig,
  readSystemConfigEntries,
  writeSystemConfig,
} from "./system-config.js";

describe("system-config 仓储", () => {
  let db: Db;

  beforeEach(async () => {
    db = await openDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  it("读写 upsert 并带回显", async () => {
    await writeSystemConfig(
      db,
      [
        { key: "public_url", value: "https://aw.example.com" },
        { key: "task_zombie_hours", value: "3" },
      ],
      1,
      "admin",
    );
    const rows = await readSystemConfig(db);
    expect(rows["public_url"]).toBe("https://aw.example.com");
    expect(rows["task_zombie_hours"]).toBe("3");

    const entries = await readSystemConfigEntries(db);
    expect(entries.length).toBe(2);
    expect(entries[0]).toMatchObject({ updatedBy: "admin", value: expect.any(String) });
  });

  it("空库回落到空对象", async () => {
    const rows = await readSystemConfig(db);
    expect(Object.keys(rows).length).toBe(0);
  });

  it("同 key 覆盖", async () => {
    await writeSystemConfig(db, [{ key: "feishu_app_id", value: "app1" }], 1, "admin");
    await writeSystemConfig(db, [{ key: "feishu_app_id", value: "app2" }], 2, "admin");
    const rows = await readSystemConfig(db);
    expect(rows["feishu_app_id"]).toBe("app2");
  });
});
