import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import { runMigrations } from "../migrator.js";
import {
  deleteIngestReceiptsBefore,
  hasIngestReceipt,
  insertIngestReceipt,
} from "./ingest-receipt.js";

function prepare(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  db.prepare(
    "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'hash', 'active', 0)",
  ).run();
  return db;
}

const key = { collectorId: "m1", streamId: "claude-session:s1", seq: 3 };

describe("ingest_receipt 仓储", () => {
  it("插入后可按键查到,重复插入返回 false", () => {
    const db = prepare();

    expect(hasIngestReceipt(db, key)).toBe(false);
    expect(insertIngestReceipt(db, { ...key, receivedAt: 1_000 })).toBe(true);
    expect(hasIngestReceipt(db, key)).toBe(true);
    expect(insertIngestReceipt(db, { ...key, receivedAt: 2_000 })).toBe(false);
    db.close();
  });

  it("同 collector 不同流 / seq 互不影响", () => {
    const db = prepare();
    insertIngestReceipt(db, { ...key, receivedAt: 1_000 });

    expect(hasIngestReceipt(db, { ...key, streamId: "claude-session:s2" })).toBe(false);
    expect(hasIngestReceipt(db, { ...key, seq: 4 })).toBe(false);
    db.close();
  });

  it("按 received_at 滚动清理,只删窗口外的行", () => {
    const db = prepare();
    insertIngestReceipt(db, { ...key, seq: 1, receivedAt: 1_000 });
    insertIngestReceipt(db, { ...key, seq: 2, receivedAt: 5_000 });

    expect(deleteIngestReceiptsBefore(db, 3_000)).toBe(1);
    expect(hasIngestReceipt(db, { ...key, seq: 1 })).toBe(false);
    expect(hasIngestReceipt(db, { ...key, seq: 2 })).toBe(true);
    db.close();
  });
});
