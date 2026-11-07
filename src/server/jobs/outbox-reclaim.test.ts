import { describe, expect, it } from "vitest";
import { enqueuePull } from "../../reliability/outbox.js";
import { openDatabase, type Db } from "../../store/database.js";
import { claimPullByMsgId, findOutboxByKey } from "../../store/repositories/outbox.js";
import { reclaimOnce, startOutboxReclaimer } from "./outbox-reclaim.js";

const KEY = "a2a:msg_1:request";

async function prepare(): Promise<Db> {
  const db = await openDatabase();
  await enqueuePull(db, {
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
  it("未 ACK 的 claimed 行过期后回到 retry_wait 并可再次领取", async () => {
    const db = await prepare();
    const first = await claimPullByMsgId(db, "msg_1", 0, 30_000);
    expect(first?.status).toBe("claimed");
    const log = logger();

    const outcome = await reclaimOnce(db, 30_001, log);

    expect(outcome).toEqual({ retryWait: 1, uncertain: 0 });
    expect(await findOutboxByKey(db, KEY)).toMatchObject({ status: "retry_wait", availableAt: 30_001 });
    expect(log.infos).toEqual([{ retryWait: 1, uncertain: 0 }]);
    expect((await claimPullByMsgId(db, "msg_1", 30_001, 60_001))?.status).toBe("claimed");
    await db.close();
  });

  it("租约未过期时不动", async () => {
    const db = await prepare();
    await claimPullByMsgId(db, "msg_1", 0, 30_000);
    const log = logger();

    expect(await reclaimOnce(db, 10_000, log)).toEqual({ retryWait: 0, uncertain: 0 });
    expect((await findOutboxByKey(db, KEY))?.status).toBe("claimed");
    expect(log.infos).toEqual([]);
    await db.close();
  });
});

describe("startOutboxReclaimer", () => {
  it("启动即回收一轮过期租约", async () => {
    const db = await prepare();
    await claimPullByMsgId(db, "msg_1", 0, 30_000);
    const log = logger();

    const reclaimer = startOutboxReclaimer(db, log, {
      now: () => 30_001,
      intervalMs: 60_000,
    });

    // 回收异步落库,给微任务一拍时间
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await findOutboxByKey(db, KEY))?.status).toBe("retry_wait");
    reclaimer.stop();
    await db.close();
  });
});
