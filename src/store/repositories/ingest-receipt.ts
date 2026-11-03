import type { Db } from "../database.js";

export interface IngestReceiptKey {
  collectorId: string;
  streamId: string;
  seq: number;
}

export interface NewIngestReceipt extends IngestReceiptKey {
  receivedAt: number;
}

export function hasIngestReceipt(db: Db, key: IngestReceiptKey): Promise<boolean>{
  return (
    await db.get("SELECT 1 FROM ingest_receipt WHERE collector_id = ? AND stream_id = ? AND seq = ?",, key.collectorId, key.streamId, key.seq) !== undefined
  );
}

/** 返回 false 表示该 (collector, stream, seq) 已被其他请求先写入 */
export function insertIngestReceipt(db: Db, row: NewIngestReceipt): Promise<boolean>{
  return (
    (await db.run(``INSERT INTO ingest_receipt (collector_id, stream_id, seq, received_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,`, row.collectorId, row.streamId, row.seq, row.receivedAt)).changes === 1
  );
}

/** 7 天窗口滚动清理;返回删除条数 */
export function deleteIngestReceiptsBefore(db: Db, before: number): Promise<number>{
  return (await db.run("DELETE FROM ingest_receipt WHERE received_at < ?", before)).changes;
}
