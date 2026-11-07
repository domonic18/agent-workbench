import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import {
  deleteIngestReceiptsBefore,
  hasIngestReceipt,
  insertIngestReceipt,
} from "./ingest-receipt.js";

async function prepare(): Promise<Db> {
  const db = await openDatabase();
  await db.run(
    "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'hash', 'active', 0)",
  );
  return db;
}

const key = { collectorId: "m1", streamId: "claude-session:s1", seq: 3 };

describe("ingest_receipt 仓储", () => {
  it("插入后可按键查到,重复插入返回 false", async () => {
    const db = await prepare();

    expect(await hasIngestReceipt(db, key)).toBe(false);
    expect(await insertIngestReceipt(db, { ...key, receivedAt: 1_000 })).toBe(true);
    expect(await hasIngestReceipt(db, key)).toBe(true);
    expect(await insertIngestReceipt(db, { ...key, receivedAt: 2_000 })).toBe(false);
    await db.close();
  });

  it("同 collector 不同流 / seq 互不影响", async () => {
    const db = await prepare();
    await insertIngestReceipt(db, { ...key, receivedAt: 1_000 });

    expect(await hasIngestReceipt(db, { ...key, streamId: "claude-session:s2" })).toBe(false);
    expect(await hasIngestReceipt(db, { ...key, seq: 4 })).toBe(false);
    await db.close();
  });

  it("按 received_at 滚动清理,只删窗口外的行", async () => {
    const db = await prepare();
    await insertIngestReceipt(db, { ...key, seq: 1, receivedAt: 1_000 });
    await insertIngestReceipt(db, { ...key, seq: 2, receivedAt: 5_000 });

    expect(await deleteIngestReceiptsBefore(db, 3_000)).toBe(1);
    expect(await hasIngestReceipt(db, { ...key, seq: 1 })).toBe(false);
    expect(await hasIngestReceipt(db, { ...key, seq: 2 })).toBe(true);
    await db.close();
  });
});
