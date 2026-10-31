import { describe, expect, it } from "vitest";
import { openDatabase } from "../database.js";
import { runMigrations } from "../migrator.js";
import { claimFeishuEvent } from "./feishu-event.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function prepare() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}

describe("claimFeishuEvent", () => {
  it("首次认领成功,重复 event_id 不再认领", () => {
    const db = prepare();
    const now = 1_700_000_000_000;

    expect(claimFeishuEvent(db, "evt_1", "im.message.receive_v1", now)).toBe(true);
    expect(claimFeishuEvent(db, "evt_1", "im.message.receive_v1", now + 1000)).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM feishu_event").get()).toEqual({ n: 1 });
    db.close();
  });

  it("只保留 7 天窗口,过期事件被清理", () => {
    const db = prepare();
    const now = 1_700_000_000_000;
    db.prepare("INSERT INTO feishu_event (event_id, event_type, received_at) VALUES (?, ?, ?)").run(
      "evt_old",
      "im.message.receive_v1",
      now - 8 * DAY_MS,
    );

    expect(claimFeishuEvent(db, "evt_new", "im.message.receive_v1", now)).toBe(true);
    expect(db.prepare("SELECT event_id FROM feishu_event ORDER BY event_id").all()).toEqual([
      { event_id: "evt_new" },
    ]);
    db.close();
  });
});
