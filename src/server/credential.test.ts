import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../store/database.js";
import {
  ensureConsoleCredential,
  hasConsoleCredential,
  verifyConsolePassword,
} from "./credential.js";

async function freshDb(): Promise<Db> {
  return openDatabase();
}

describe("console credential", () => {
  it("首次初始化后只存哈希,并能校验口令", async () => {
    const db = await freshDb();
    expect(await ensureConsoleCredential(db, "simple-123456")).toEqual({ created: true });

    const row = (await db.get(
      "SELECT password_hash FROM console_credential WHERE id = 1",
    )) as { password_hash: string };
    expect(row.password_hash.startsWith("scrypt$")).toBe(true);
    expect(row.password_hash).not.toContain("simple-123456");

    expect(await verifyConsolePassword(db, "simple-123456")).toBe(true);
    expect(await verifyConsolePassword(db, "simple-124")).toBe(false);
    await db.close();
  });

  it("已初始化时忽略新种子,不改写口令", async () => {
    const db = await freshDb();
    await ensureConsoleCredential(db, "simple-123456");
    expect(await ensureConsoleCredential(db, "another-456789")).toEqual({ created: false });

    expect(await verifyConsolePassword(db, "simple-123456")).toBe(true);
    expect(await verifyConsolePassword(db, "another-456789")).toBe(false);
    expect(
      await db.get("SELECT COUNT(*) AS n FROM console_credential"),
    ).toEqual({ n: 1 });
    await db.close();
  });

  it("缺种子不抛错(bootstrap mode);种子过短仍拒绝启动", async () => {
    const db = await freshDb();
    expect(await ensureConsoleCredential(db)).toEqual({ created: false });
    expect(await hasConsoleCredential(db)).toBe(false);
    await expect(ensureConsoleCredential(db, "12345678901")).rejects.toThrow(/至少 12 位/);
    expect(await hasConsoleCredential(db)).toBe(false);
    await db.close();
  });

  it("损坏的哈希一律校验失败,不抛异常", async () => {
    const db = await freshDb();
    await ensureConsoleCredential(db, "simple-123456");
    await db.run("UPDATE console_credential SET password_hash = ? WHERE id = 1", "broken");

    expect(await verifyConsolePassword(db, "simple-123456")).toBe(false);
    await db.close();
  });
});
