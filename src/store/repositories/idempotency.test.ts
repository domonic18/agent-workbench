import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import { runMigrations } from "../migrator.js";
import { findIdempotencyResource, saveIdempotencyResource } from "./idempotency.js";

function prepare(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}

const record = { scope: "capability.create", key: "k1", resourceId: "cap_1", createdAt: 1_000 };

describe("idempotency_record 仓储", () => {
  it("按键查询首次资源,未见过时返回 undefined", () => {
    const db = prepare();

    expect(findIdempotencyResource(db, record.scope, record.key)).toBeUndefined();
    saveIdempotencyResource(db, record);
    expect(findIdempotencyResource(db, record.scope, record.key)).toBe("cap_1");
    db.close();
  });

  it("同键不同作用域互不影响", () => {
    const db = prepare();
    saveIdempotencyResource(db, record);

    expect(findIdempotencyResource(db, "task.create", record.key)).toBeUndefined();
    expect(findIdempotencyResource(db, record.scope, "k2")).toBeUndefined();
    db.close();
  });

  it("重复写入同键违反主键,由调用方按先查后写规避", () => {
    const db = prepare();
    saveIdempotencyResource(db, record);

    expect(() => saveIdempotencyResource(db, { ...record, resourceId: "cap_2" })).toThrow();
    expect(findIdempotencyResource(db, record.scope, record.key)).toBe("cap_1");
    db.close();
  });
});
