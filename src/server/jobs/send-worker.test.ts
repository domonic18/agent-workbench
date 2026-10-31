import { describe, expect, it } from "vitest";
import type { CardSender, CardTarget } from "../../adapters/feishu/card.js";
import { enqueuePush } from "../../reliability/outbox.js";
import { openDatabase } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { findOutboxByKey } from "../../store/repositories/outbox.js";
import { drainOutbox, retryDelayMs } from "./send-worker.js";

const silentLogger = { info() {}, warn() {}, error() {} };

function prepare() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  enqueuePush(db, {
    idempotencyKey: "cap:cap_1:requested",
    kind: "capability_approval",
    chatId: "oc_1",
    card: { schema: "2.0" },
    now: 0,
  });
  return db;
}

describe("drainOutbox", () => {
  it("同步发送期间出箱置 sending", async () => {
    const db = prepare();
    let observed: string | undefined;
    const sender: CardSender = {
      async send() {
        observed = findOutboxByKey(db, "cap:cap_1:requested")?.status;
      },
    };

    await drainOutbox(db, sender, silentLogger, () => 0);

    expect(observed).toBe("sending");
    expect(findOutboxByKey(db, "cap:cap_1:requested")?.status).toBe("delivered");
    db.close();
  });

  it("投递成功置 delivered", async () => {
    const db = prepare();
    const sent: CardTarget[] = [];
    const sender: CardSender = {
      async send(target) {
        sent.push(target);
      },
    };

    await drainOutbox(db, sender, silentLogger, () => 0);

    expect(sent).toEqual([{ chatId: "oc_1", card: { schema: "2.0" } }]);
    expect(findOutboxByKey(db, "cap:cap_1:requested")).toMatchObject({
      status: "delivered",
      attempts: 1,
    });
    db.close();
  });

  it("失败回 retry_wait,到点后重投成功", async () => {
    const db = prepare();
    let fail = true;
    const sender: CardSender = {
      async send() {
        if (fail) {
          throw new Error("timeout");
        }
      },
    };

    await drainOutbox(db, sender, silentLogger, () => 0);
    expect(findOutboxByKey(db, "cap:cap_1:requested")).toMatchObject({
      status: "retry_wait",
      attempts: 1,
    });

    fail = false;
    await drainOutbox(db, sender, silentLogger, () => retryDelayMs(1));
    expect(findOutboxByKey(db, "cap:cap_1:requested")).toMatchObject({
      status: "delivered",
      attempts: 2,
    });
    db.close();
  });

  it("连续失败到上限判 failed", async () => {
    const db = prepare();
    const sender: CardSender = {
      async send() {
        throw new Error("boom");
      },
    };
    let clock = 0;
    for (let i = 0; i < 8; i += 1) {
      await drainOutbox(db, sender, silentLogger, () => clock);
      clock += 60 * 60 * 1000;
    }

    expect(findOutboxByKey(db, "cap:cap_1:requested")).toMatchObject({
      status: "failed",
      attempts: 8,
      lastError: "boom",
    });
    db.close();
  });

});

describe("retryDelayMs", () => {
  it("按指数退避并封顶", () => {
    expect(retryDelayMs(0)).toBe(5_000);
    expect(retryDelayMs(1)).toBe(10_000);
    expect(retryDelayMs(20)).toBe(5 * 60 * 1000);
  });
});
