import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
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

async function prepare(): Promise<Db> {
  // openDatabase 已在独立 PG 库上执行迁移
  return openDatabase();
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
  it("同幂等键只入队一次", async () => {
    const db = await prepare();
    const first = await insertOutbox(db, newRow());
    const again = await insertOutbox(db, newRow({ id: "ob_2" }));

    expect(again.id).toBe(first.id);
    expect(await db.get("SELECT COUNT(*) AS n FROM outbox")).toEqual({ n: 1 });
    await db.close();
  });

  it("领取到期记录并累加 attempts 与租约", async () => {
    const db = await prepare();
    await insertOutbox(db, newRow());

    const claimed = await claimDue(db, 1_000, 31_000);
    expect(claimed).toMatchObject({ id: "ob_1", status: "claimed", attempts: 1, leaseToken: 1 });
    expect(claimed?.leaseUntil).toBe(31_000);

    // 已领取,没有其它到期记录
    expect(await claimDue(db, 1_000, 62_000)).toBeUndefined();
    await db.close();
  });

  it("未到 available_at 不领取", async () => {
    const db = await prepare();
    await insertOutbox(db, newRow({ availableAt: 5_000 }));

    expect(await claimDue(db, 4_999, 30_000)).toBeUndefined();
    expect((await claimDue(db, 5_000, 30_000))?.status).toBe("claimed");
    await db.close();
  });

  it("提交结果必须带匹配的租约 token", async () => {
    const db = await prepare();
    await insertOutbox(db, newRow());
    const claimed = await claimDue(db, 1_000, 31_000);

    expect(await markDelivered(db, claimed!.id, claimed!.leaseToken + 1)).toBe(false);
    expect((await findOutbox(db, "ob_1"))?.status).toBe("claimed");

    expect(await markDelivered(db, claimed!.id, claimed!.leaseToken)).toBe(true);
    expect((await findOutbox(db, "ob_1"))?.status).toBe("delivered");
    await db.close();
  });

  it("重试回 retry_wait 并记录下次可用时间", async () => {
    const db = await prepare();
    await insertOutbox(db, newRow());
    const claimed = await claimDue(db, 1_000, 31_000);

    expect(await markRetry(db, claimed!.id, claimed!.leaseToken, 9_000, "timeout")).toBe(true);
    expect(await findOutbox(db, "ob_1")).toMatchObject({
      status: "retry_wait",
      availableAt: 9_000,
      lastError: "timeout",
      leaseUntil: null,
    });
    await db.close();
  });

  it("判死记录 last_error", async () => {
    const db = await prepare();
    await insertOutbox(db, newRow());
    const claimed = await claimDue(db, 1_000, 31_000);

    expect(await markFailed(db, claimed!.id, claimed!.leaseToken, "bad request")).toBe(true);
    expect(await findOutbox(db, "ob_1")).toMatchObject({ status: "failed", lastError: "bad request" });
    await db.close();
  });

  it("过期租约回收为 retry_wait,可在下一轮重新领取", async () => {
    const db = await prepare();
    await insertOutbox(db, newRow());
    await claimDue(db, 1_000, 31_000);

    expect(await reconcileStaleLeases(db, 31_000)).toEqual({ retryWait: 0, uncertain: 0 });
    expect(await reconcileStaleLeases(db, 31_001)).toEqual({ retryWait: 1, uncertain: 0 });
    expect((await findOutbox(db, "ob_1"))?.status).toBe("retry_wait");
    expect((await claimDue(db, 31_001, 61_000))?.status).toBe("claimed");
    await db.close();
  });

  it("按 channel 领取,push worker 不误领 pull 行", async () => {
    const db = await prepare();
    await insertOutbox(
      db,
      newRow({
        id: "ob_pull",
        idempotencyKey: "pull-key",
        channel: "pull",
        deliveryClass: "business",
        msgId: "msg_1",
      }),
    );
    await insertOutbox(db, newRow({ id: "ob_push", idempotencyKey: "push-key" }));

    expect(await claimDue(db, 1_000, 31_000)).toMatchObject({ id: "ob_push", channel: "push" });
    expect(await claimDue(db, 1_000, 31_000)).toBeUndefined();
    expect(await claimDue(db, 1_000, 31_000, "pull")).toMatchObject({ id: "ob_pull", channel: "pull" });
    await db.close();
  });

  it("claimed → sending → uncertain;sending 过期不再自动重放", async () => {
    const db = await prepare();
    await insertOutbox(db, newRow());
    const claimed = await claimDue(db, 1_000, 31_000);

    expect(await markSending(db, "ob_1", claimed!.leaseToken + 1)).toBe(false);
    expect(await markSending(db, "ob_1", claimed!.leaseToken)).toBe(true);
    expect((await findOutbox(db, "ob_1"))?.status).toBe("sending");

    expect(await markUncertain(db, "ob_1", claimed!.leaseToken)).toBe(true);
    expect(await findOutbox(db, "ob_1")).toMatchObject({ status: "uncertain", leaseUntil: null });
    await db.close();
  });

  it("sending 租约过期转 uncertain 而非 retry_wait", async () => {
    const db = await prepare();
    await insertOutbox(db, newRow());
    const claimed = await claimDue(db, 1_000, 31_000);
    await markSending(db, "ob_1", claimed!.leaseToken);

    expect(await reconcileStaleLeases(db, 31_001)).toEqual({ retryWait: 0, uncertain: 1 });
    expect((await findOutbox(db, "ob_1"))?.status).toBe("uncertain");
    await db.close();
  });

  it("ACK 按 msg_id 置 delivered,不依赖租约 token", async () => {
    const db = await prepare();
    await insertOutbox(
      db,
      newRow({ id: "ob_pull", channel: "pull", deliveryClass: "business", msgId: "msg_1" }),
    );

    expect(await markDeliveredByMsgId(db, "msg_1")).toBe(true);
    expect((await findOutbox(db, "ob_pull"))?.status).toBe("delivered");
    expect(await markDeliveredByMsgId(db, "msg_1")).toBe(false);
    await db.close();
  });

  it("信箱按 msg_id 领取,未 ACK 的租约过期后重新可见", async () => {
    const db = await prepare();
    await insertOutbox(
      db,
      newRow({ id: "ob_pull", channel: "pull", deliveryClass: "business", msgId: "msg_1" }),
    );

    const first = await claimPullByMsgId(db, "msg_1", 1_000, 31_000);
    expect(first).toMatchObject({ id: "ob_pull", status: "claimed" });
    expect(await claimPullByMsgId(db, "msg_1", 1_000, 31_000)).toBeUndefined();

    await reconcileStaleLeases(db, 31_001);
    expect((await claimPullByMsgId(db, "msg_1", 31_001, 61_000))?.id).toBe("ob_pull");
    await db.close();
  });

  it("uncertain 围栏只对同任务的 business 行生效", async () => {
    const db = await prepare();
    await insertOutbox(
      db,
      newRow({
        id: "ob_fence",
        channel: "pull",
        deliveryClass: "business",
        msgId: "msg_1",
        taskId: "T-1",
      }),
    );
    await db.run("UPDATE outbox SET status = 'uncertain' WHERE id = 'ob_fence'");

    expect(await findUncertainFence(db, "T-1")).toBe(true);
    expect(await findUncertainFence(db, "T-2")).toBe(false);
    await db.close();
  });
});
