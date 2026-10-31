import { describe, expect, it } from "vitest";
import { openDatabase } from "../store/database.js";
import { runMigrations } from "../store/migrator.js";
import { ensureConsoleCredential, verifyConsolePassword } from "./credential.js";

function freshDb() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}

describe("console credential", () => {
  it("首次初始化后只存哈希,并能校验口令", () => {
    const db = freshDb();
    expect(ensureConsoleCredential(db, "simple-123")).toEqual({ created: true });

    const row = db
      .prepare("SELECT password_hash FROM console_credential WHERE id = 1")
      .get() as { password_hash: string };
    expect(row.password_hash.startsWith("scrypt$")).toBe(true);
    expect(row.password_hash).not.toContain("simple-123");

    expect(verifyConsolePassword(db, "simple-123")).toBe(true);
    expect(verifyConsolePassword(db, "simple-124")).toBe(false);
    db.close();
  });

  it("已初始化时忽略新种子,不改写口令", () => {
    const db = freshDb();
    ensureConsoleCredential(db, "simple-123");
    expect(ensureConsoleCredential(db, "another-456")).toEqual({ created: false });

    expect(verifyConsolePassword(db, "simple-123")).toBe(true);
    expect(verifyConsolePassword(db, "another-456")).toBe(false);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM console_credential").get(),
    ).toEqual({ n: 1 });
    db.close();
  });

  it("缺种子或种子过短时拒绝启动", () => {
    const db = freshDb();
    expect(() => ensureConsoleCredential(db)).toThrow(/CONSOLE_INIT_PASSWORD/);
    expect(() => ensureConsoleCredential(db, "12345")).toThrow(/至少 6 位/);
    db.close();
  });

  it("损坏的哈希一律校验失败,不抛异常", () => {
    const db = freshDb();
    ensureConsoleCredential(db, "simple-123");
    db.prepare("UPDATE console_credential SET password_hash = ? WHERE id = 1").run("broken");

    expect(verifyConsolePassword(db, "simple-123")).toBe(false);
    db.close();
  });
});
