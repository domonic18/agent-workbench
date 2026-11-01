import { describe, expect, it } from "vitest";
import { openDatabase } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { createIdempotencyService } from "./idempotency.js";

function prepare() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}

describe("幂等服务", () => {
  it("执行成功后登记键,重复查询可拿到资源 id", () => {
    const db = prepare();
    const idempotency = createIdempotencyService({ db, now: () => 1_000 });

    const created = idempotency.run("capability.create", "k1", () => ({ id: "cap_1" }));
    expect(created.id).toBe("cap_1");
    expect(idempotency.find("capability.create", "k1")).toBe("cap_1");
    db.close();
  });

  it("工作函数抛错时回滚,不留半成品键", () => {
    const db = prepare();
    const idempotency = createIdempotencyService({ db, now: () => 1_000 });

    expect(() =>
      idempotency.run("capability.create", "k1", () => {
        throw new Error("建单失败");
      }),
    ).toThrow("建单失败");
    expect(idempotency.find("capability.create", "k1")).toBeUndefined();
    db.close();
  });
});
