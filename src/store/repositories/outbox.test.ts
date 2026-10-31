import { describe, expect, it } from "vitest";
import { openDatabase } from "../database.js";
import { runMigrations } from "../migrator.js";
import {
  claimDue,
  claimPullByMsgId,
  findOutbox,
  findUncertainFence,
  insertOutbox,
  markDelivered,
  markDeliveredByMsgId,
  markFailed,
  markRetry,
  markSending,
  markUncertain,
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

    expect(reconcileStaleLeases(db, 31_000)).toEqual({ retryWait: 0, uncertain: 0 });
    expect(reconcileStaleLeases(db, 31_001)).toEqual({ retryWait: 1, uncertain: 0 });
    expect(findOutbox(db, "ob_1")?.status).toBe("retry_wait");
    expect(claimDue(db, 31_001, 61_000)?.status).toBe("claimed");
    db.close();
  });

  it("按 channel 领取,push worker 不误领 pull 行", () => {
    const db = prepare();
    insertOutbox(
      db,
      newRow({
        id: "ob_pull",
        idempotencyKey: "pull-key",
        channel: "pull",
        deliveryClass: "business",
        msgId: "msg_1",
      }),
    );
    insertOutbox(db, newRow({ id: "ob_push", idempotencyKey: "push-key" }));

    expect(claimDue(db, 1_000, 31_000)).toMatchObject({ id: "ob_push", channel: "push" });
    expect(claimDue(db, 1_000, 31_000)).toBeUndefined();
    expect(claimDue(db, 1_000, 31_000, "pull")).toMatchObject({ id: "ob_pull", channel: "pull" });
    db.close();
  });

  it("claimed → sending → uncertain;sending 过期不再自动重放", () => {
    const db = prepare();
    insertOutbox(db, newRow());
    const claimed = claimDue(db, 1_000, 31_000);

    expect(markSending(db, "ob_1", claimed!.leaseToken + 1)).toBe(false);
    expect(markSending(db, "ob_1", claimed!.leaseToken)).toBe(true);
    expect(findOutbox(db, "ob_1")?.status).toBe("sending");

    expect(markUncertain(db, "ob_1", claimed!.leaseToken)).toBe(true);
    expect(findOutbox(db, "ob_1")).toMatchObject({ status: "uncertain", leaseUntil: null });
    db.close();
  });

  it("sending 租约过期转 uncertain 而非 retry_wait", () => {
    const db = prepare();
    insertOutbox(db, newRow());
    const claimed = claimDue(db, 1_000, 31_000);
    markSending(db, "ob_1", claimed!.leaseToken);

    expect(reconcileStaleLeases(db, 31_001)).toEqual({ retryWait: 0, uncertain: 1 });
    expect(findOutbox(db, "ob_1")?.status).toBe("uncertain");
    db.close();
  });

  it("ACK 按 msg_id 置 delivered,不依赖租约 token", () => {
    const db = prepare();
    insertOutbox(
      db,
      newRow({ id: "ob_pull", channel: "pull", deliveryClass: "business", msgId: "msg_1" }),
    );

    expect(markDeliveredByMsgId(db, "msg_1")).toBe(true);
    expect(findOutbox(db, "ob_pull")?.status).toBe("delivered");
    expect(markDeliveredByMsgId(db, "msg_1")).toBe(false);
    db.close();
  });

  it("信箱按 msg_id 领取,未 ACK 的租约过期后重新可见", () => {
    const db = prepare();
    insertOutbox(
      db,
      newRow({ id: "ob_pull", channel: "pull", deliveryClass: "business", msgId: "msg_1" }),
    );

    const first = claimPullByMsgId(db, "msg_1", 1_000, 31_000);
    expect(first).toMatchObject({ id: "ob_pull", status: "claimed" });
    expect(claimPullByMsgId(db, "msg_1", 1_000, 31_000)).toBeUndefined();

    reconcileStaleLeases(db, 31_001);
    expect(claimPullByMsgId(db, "msg_1", 31_001, 61_000)?.id).toBe("ob_pull");
    db.close();
  });

  it("uncertain 围栏只对同任务的 business 行生效", () => {
    const db = prepare();
    insertOutbox(
      db,
      newRow({
        id: "ob_fence",
        channel: "pull",
        deliveryClass: "business",
        msgId: "msg_1",
        taskId: "T-1",
      }),
    );
    db.prepare("UPDATE outbox SET status = 'uncertain' WHERE id = 'ob_fence'").run();

    expect(findUncertainFence(db, "T-1")).toBe(true);
    expect(findUncertainFence(db, "T-2")).toBe(false);
    db.close();
  });
});
