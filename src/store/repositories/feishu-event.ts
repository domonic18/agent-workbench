import type { Db } from "../database.js";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 首次见到该 event_id 返回 true(已认领);重复事件返回 false。
 * 只保留 7 天窗口,与采集去重同口径:飞书重推不会迟到一周以上。
 */
export async function claimFeishuEvent(
  db: Db,
  eventId: string,
  eventType: string,
  now: number = Date.now(),
): Promise<boolean> {
  const inserted = await db.run(
    "INSERT INTO feishu_event (event_id, event_type, received_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    eventId, eventType, now,
  );
  if (inserted.changes === 0) {
    return false;
  }
  await db.run("DELETE FROM feishu_event WHERE received_at < ?", now - RETENTION_MS);
  return true;
}
