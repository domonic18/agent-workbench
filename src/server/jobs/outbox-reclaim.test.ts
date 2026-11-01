import { describe, expect, it } from "vitest";
import { enqueuePull } from "../../reliability/outbox.js";
import { openDatabase } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { claimPullByMsgId, findOutboxByKey } from "../../store/repositories/outbox.js";
import { reclaimOnce, startOutboxReclaimer } from "./outbox-reclaim.js";

const KEY = "a2a:msg_1:request";

function prepare() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  enqueuePull(db, {
    idempotencyKey: KEY,
    kind: "a2a_request",
    taskId: "tsk_1",
    msgId: "msg_1",
    payloadJson: "{}",
    now: 0,
  });
  return db;
}

function logger() {
  const infos: unknown[] = [];
  return {
    infos,
    info(obj: unknown) {
      infos.push(obj);
    },
    warn() {},
    error() {},
  };
}

describe("reclaimOnce", () => {
  it("未 ACK 的 claimed 行过期后回到 retry_wait 并可再次领取", () => {
    const db = prepare();
    const first = claimPullByMsgId(db, "msg_1", 0, 30_000);
    expect(first?.status).toBe("claimed");
    const log = logger();

    const outcome = reclaimOnce(db, 30_001, log);

    expect(outcome).toEqual({ retryWait: 1, uncertain: 0 });
    expect(findOutboxByKey(db, KEY)).toMatchObject({ status: "retry_wait", availableAt: 30_001 });
    expect(log.infos).toEqual([{ retryWait: 1, uncertain: 0 }]);
    expect(claimPullByMsgId(db, "msg_1", 30_001, 60_001)?.status).toBe("claimed");
    db.close();
  });

  it("租约未过期时不动", () => {
    const db = prepare();
    claimPullByMsgId(db, "msg_1", 0, 30_000);
    const log = logger();

    expect(reclaimOnce(db, 10_000, log)).toEqual({ retryWait: 0, uncertain: 0 });
    expect(findOutboxByKey(db, KEY)?.status).toBe("claimed");
    expect(log.infos).toEqual([]);
    db.close();
  });
});

describe("startOutboxReclaimer", () => {
  it("启动即回收一轮过期租约", () => {
    const db = prepare();
    claimPullByMsgId(db, "msg_1", 0, 30_000);
    const log = logger();

    const reclaimer = startOutboxReclaimer(db, log, {
      now: () => 30_001,
      intervalMs: 60_000,
    });

    expect(findOutboxByKey(db, KEY)?.status).toBe("retry_wait");
    reclaimer.stop();
    db.close();
  });
});
