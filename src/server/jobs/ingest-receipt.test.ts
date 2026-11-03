import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { hasIngestReceipt, insertIngestReceipt } from "../../store/repositories/ingest-receipt.js";
import { startIngestReceiptCleaner } from "./ingest-receipt.js";

function prepare(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  await db.run(
    "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'hash', 'active', 0)",
  );
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

describe("startIngestReceiptCleaner", () => {
  it("启动即清窗口外回执,窗口内保留并记日志", () => {
    const db = prepare();
    insertIngestReceipt(db, {
      collectorId: "m1",
      streamId: "s1",
      seq: 1,
      receivedAt: 1_000,
    });
    insertIngestReceipt(db, {
      collectorId: "m1",
      streamId: "s1",
      seq: 2,
      receivedAt: 5_000,
    });
    const log = logger();

    const cleaner = startIngestReceiptCleaner(db, log, {
      now: () => 6_000,
      retentionMs: 2_000,
      intervalMs: 60_000,
    });

    expect(hasIngestReceipt(db, { collectorId: "m1", streamId: "s1", seq: 1 })).toBe(false);
    expect(hasIngestReceipt(db, { collectorId: "m1", streamId: "s1", seq: 2 })).toBe(true);
    expect(log.infos).toEqual([{ deleted: 1 }]);
    cleaner.stop();
    db.close();
  });

  it("无可清理行时不记日志", () => {
    const db = prepare();
    const log = logger();

    const cleaner = startIngestReceiptCleaner(db, log, {
      now: () => 1_000,
      retentionMs: 2_000,
      intervalMs: 60_000,
    });

    expect(log.infos).toEqual([]);
    cleaner.stop();
    db.close();
  });
});
