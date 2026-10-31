import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../store/database.js";
import { runMigrations } from "../store/migrator.js";
import { enqueuePush } from "./outbox.js";

function prepare() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}

describe("enqueuePush", () => {
  it("入队一条 push/notification 记录并落地载荷", () => {
    const db = prepare();
    const card = { schema: "2.0" };
    const row = enqueuePush(db, {
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
    db.close();
  });

  it("同幂等键重复入队不新增行", () => {
    const db = prepare();
    const input = {
      idempotencyKey: "cap:cap_1:requested",
      kind: "capability_approval",
      chatId: "oc_1",
      card: { a: 1 },
    };
    const first = enqueuePush(db, input);
    const second = enqueuePush(db, input);

    expect(second.id).toBe(first.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 1 });
    db.close();
  });

  it("缺省 taskId 记为 NULL", () => {
    const db = prepare();
    const row = enqueuePush(db, {
      idempotencyKey: "k",
      kind: "x",
      chatId: "oc_1",
      card: {},
    });
    expect(row.taskId).toBeNull();
    db.close();
  });
});
