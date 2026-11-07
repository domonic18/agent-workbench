import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../store/database.js";
import { enqueuePush } from "./outbox.js";

async function prepare(): Promise<Db> {
  return openDatabase();
}

describe("enqueuePush", () => {
  it("入队一条 push/notification 记录并落地载荷", async () => {
    const db = await prepare();
    const card = { schema: "2.0" };
    const row = await enqueuePush(db, {
      idempotencyKey: "cap:cap_1:requested",
      kind: "capability_approval",
      taskId: "T-1",
      chatId: "oc_1",
      card,
      now: 1_000,
    });

    expect(row).toMatchObject({
      idempotencyKey: "cap:cap_1:requested",
      channel: "push",
      deliveryClass: "notification",
      status: "pending",
      attempts: 0,
      taskId: "T-1",
      availableAt: 1_000,
      createdAt: 1_000,
    });
    expect(JSON.parse(row.payloadJson)).toEqual({ chatId: "oc_1", card });
    expect(row.payloadHash).toBe(
      createHash("sha256").update(JSON.stringify({ chatId: "oc_1", card })).digest("hex"),
    );
    await db.close();
  });

  it("同幂等键重复入队不新增行", async () => {
    const db = await prepare();
    const input = {
      idempotencyKey: "cap:cap_1:requested",
      kind: "capability_approval",
      chatId: "oc_1",
      card: { a: 1 },
    };
    const first = await enqueuePush(db, input);
    const second = await enqueuePush(db, input);

    expect(second.id).toBe(first.id);
    expect(await db.get("SELECT COUNT(*) AS n FROM outbox")).toEqual({ n: 1 });
    await db.close();
  });

  it("缺省 taskId 记为 NULL", async () => {
    const db = await prepare();
    const row = await enqueuePush(db, {
      idempotencyKey: "k",
      kind: "x",
      chatId: "oc_1",
      card: {},
    });
    expect(row.taskId).toBeNull();
    await db.close();
  });
});
