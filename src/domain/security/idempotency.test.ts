import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { createIdempotencyService } from "./idempotency.js";

async function prepare(): Promise<Db> {
  return openDatabase();
}

describe("幂等服务", () => {
  it("执行成功后登记键,重复查询可拿到资源 id", async () => {
    const db = await prepare();
    const idempotency = createIdempotencyService({ db, now: () => 1_000 });

    const created = await idempotency.run("capability.create", "k1", async () => ({ id: "cap_1" }));
    expect(created.id).toBe("cap_1");
    expect(await idempotency.find("capability.create", "k1")).toBe("cap_1");
    await db.close();
  });

  it("工作函数抛错时回滚,不留半成品键", async () => {
    const db = await prepare();
    const idempotency = createIdempotencyService({ db, now: () => 1_000 });

    await expect(
      idempotency.run("capability.create", "k1", async () => {
        throw new Error("建单失败");
      }),
    ).rejects.toThrow("建单失败");
    expect(await idempotency.find("capability.create", "k1")).toBeUndefined();
    await db.close();
  });
});
