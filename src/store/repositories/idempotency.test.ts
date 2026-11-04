import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import { findIdempotencyResource, saveIdempotencyResource } from "./idempotency.js";

async function prepare(): Promise<Db> {
  return openDatabase();
}

const record = { scope: "capability.create", key: "k1", resourceId: "cap_1", createdAt: 1_000 };

describe("idempotency_record 仓储", () => {
  it("按键查询首次资源,未见过时返回 undefined", async () => {
    const db = await prepare();

    expect(await findIdempotencyResource(db, record.scope, record.key)).toBeUndefined();
    await saveIdempotencyResource(db, record);
    expect(await findIdempotencyResource(db, record.scope, record.key)).toBe("cap_1");
    await db.close();
  });

  it("同键不同作用域互不影响", async () => {
    const db = await prepare();
    await saveIdempotencyResource(db, record);

    expect(await findIdempotencyResource(db, "task.create", record.key)).toBeUndefined();
    expect(await findIdempotencyResource(db, record.scope, "k2")).toBeUndefined();
    await db.close();
  });

  it("重复写入同键违反主键,由调用方按先查后写规避", async () => {
    const db = await prepare();
    await saveIdempotencyResource(db, record);

    await expect(saveIdempotencyResource(db, { ...record, resourceId: "cap_2" })).rejects.toThrow();
    expect(await findIdempotencyResource(db, record.scope, record.key)).toBe("cap_1");
    await db.close();
  });
});
