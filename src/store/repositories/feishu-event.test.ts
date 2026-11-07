import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import { claimFeishuEvent } from "./feishu-event.js";

const DAY_MS = 24 * 60 * 60 * 1000;

async function prepare(): Promise<Db> {
  return openDatabase();
}

describe("claimFeishuEvent", () => {
  it("首次认领成功,重复 event_id 不再认领", async () => {
    const db = await prepare();
    const now = 1_700_000_000_000;

    expect(await claimFeishuEvent(db, "evt_1", "im.message.receive_v1", now)).toBe(true);
    expect(await claimFeishuEvent(db, "evt_1", "im.message.receive_v1", now + 1000)).toBe(false);
    expect(await db.get("SELECT COUNT(*) AS n FROM feishu_event")).toEqual({ n: 1 });
    await db.close();
  });

  it("只保留 7 天窗口,过期事件被清理", async () => {
    const db = await prepare();
    const now = 1_700_000_000_000;
    await db.run(
      "INSERT INTO feishu_event (event_id, event_type, received_at) VALUES (?, ?, ?)",
      "evt_old", "im.message.receive_v1", now - 8 * DAY_MS,
    );

    expect(await claimFeishuEvent(db, "evt_new", "im.message.receive_v1", now)).toBe(true);
    expect(await db.all("SELECT event_id FROM feishu_event ORDER BY event_id")).toEqual([
      { event_id: "evt_new" },
    ]);
    await db.close();
  });
});
