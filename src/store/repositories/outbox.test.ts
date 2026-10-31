import { describe, expect, it } from "vitest";
import { openDatabase } from "../database.js";
import { runMigrations } from "../migrator.js";
import {
  claimDue,
  findOutbox,
  insertOutbox,
  markDelivered,
  markFailed,
  markRetry,
  reconcileStaleLeases,
  type NewOutbox,
} from "./outbox.js";

function prepare() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}

function newRow(overrides: Partial<NewOutbox> = {}): NewOutbox {
  return {
    id: "ob_1",
    idempotencyKey: "cap:cap_1:requested",
    channel: "push",
    deliveryClass: "notification",
    taskId: "T-1",
    msgId: null,
    kind: "capability_approval",
    payloadHash: "hash",
    payloadJson: JSON.stringify({ chatId: "oc_1", card: { a: 1 } }),
    availableAt: 1_000,
    createdAt: 1_000,
    ...overrides,
  };
}

describe("outbox 仓储", () => {
  it("同幂等键只入队一次", () => {
    const db = prepare();
    const first = insertOutbox(db, newRow());
    const again = insertOutbox(db, newRow({ id: "ob_2" }));

    expect(again.id).toBe(first.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 1 });
    db.close();
  });

  it("领取到期记录并累加 attempts 与租约", () => {
    const db = prepare();
    insertOutbox(db, newRow());

    const claimed = claimDue(db, 1_000, 31_000);
    expect(claimed).toMatchObject({ id: "ob_1", status: "claimed", attempts: 1, leaseToken: 1 });
    expect(claimed?.leaseUntil).toBe(31_000);

    // 已领取,没有其它到期记录
    expect(claimDue(db, 1_000, 62_000)).toBeUndefined();
    db.close();
  });

  it("未到 available_at 不领取", () => {
    const db = prepare();
    insertOutbox(db, newRow({ availableAt: 5_000 }));

    expect(claimDue(db, 4_999, 30_000)).toBeUndefined();
    expect(claimDue(db, 5_000, 30_000)?.status).toBe("claimed");
    db.close();
  });

  it("提交结果必须带匹配的租约 token", () => {
    const db = prepare();
    insertOutbox(db, newRow());
    const claimed = claimDue(db, 1_000, 31_000);

    expect(markDelivered(db, claimed!.id, claimed!.leaseToken + 1)).toBe(false);
    expect(findOutbox(db, "ob_1")?.status).toBe("claimed");

    expect(markDelivered(db, claimed!.id, claimed!.leaseToken)).toBe(true);
    expect(findOutbox(db, "ob_1")?.status).toBe("delivered");
    db.close();
  });

  it("重试回 retry_wait 并记录下次可用时间", () => {
    const db = prepare();
    insertOutbox(db, newRow());
    const claimed = claimDue(db, 1_000, 31_000);

    expect(markRetry(db, claimed!.id, claimed!.leaseToken, 9_000, "timeout")).toBe(true);
    expect(findOutbox(db, "ob_1")).toMatchObject({
      status: "retry_wait",
      availableAt: 9_000,
      lastError: "timeout",
      leaseUntil: null,
    });
    db.close();
  });

  it("判死记录 last_error", () => {
    const db = prepare();
    insertOutbox(db, newRow());
    const claimed = claimDue(db, 1_000, 31_000);

    expect(markFailed(db, claimed!.id, claimed!.leaseToken, "bad request")).toBe(true);
    expect(findOutbox(db, "ob_1")).toMatchObject({ status: "failed", lastError: "bad request" });
    db.close();
  });

  it("过期租约回收为 retry_wait,可在下一轮重新领取", () => {
    const db = prepare();
    insertOutbox(db, newRow());
    claimDue(db, 1_000, 31_000);

    expect(reconcileStaleLeases(db, 31_000)).toBe(0);
    expect(reconcileStaleLeases(db, 31_001)).toBe(1);
    expect(findOutbox(db, "ob_1")?.status).toBe("retry_wait");
    expect(claimDue(db, 31_001, 61_000)?.status).toBe("claimed");
    db.close();
  });
});
