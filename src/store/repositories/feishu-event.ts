import type { Db } from "../database.js";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 首次见到该 event_id 返回 true(已认领);重复事件返回 false。
 * 只保留 7 天窗口,与采集去重同口径:飞书重推不会迟到一周以上。
 */
export function claimFeishuEvent(
  db: Db,
  eventId: string,
  eventType: string,
  now: number = Date.now(),
): boolean {
  const inserted = db
    .prepare(
      "INSERT OR IGNORE INTO feishu_event (event_id, event_type, received_at) VALUES (?, ?, ?)",
    )
    .run(eventId, eventType, now);
  if (inserted.changes === 0) {
    return false;
  }
  db.prepare("DELETE FROM feishu_event WHERE received_at < ?").run(now - RETENTION_MS);
  return true;
}
