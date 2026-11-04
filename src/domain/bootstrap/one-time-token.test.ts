import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import {
  consumeOneTimeToken,
  issueOneTimeToken,
  mintTokenValue,
  peekOneTimeToken,
} from "./one-time-token.js";

const clock = 1_000_000;

async function dbFixture(): Promise<Db> {
  return openDatabase();
}

describe("one-time token", () => {
  it("签发→消费成功;再消费拒绝为已失效", async () => {
    const db = await dbFixture();
    const { token } = await issueOneTimeToken(db, {
      purpose: "enroll",
      ttlMs: 60_000,
      now: () => clock,
    });
    expect(token).toMatch(/^ott_[A-Za-z0-9_-]{43}$/);
    expect(await consumeOneTimeToken(db, { purpose: "enroll", token, now: () => clock })).toEqual({
      ok: true,
    });
    expect(await consumeOneTimeToken(db, { purpose: "enroll", token, now: () => clock })).toEqual({
      ok: false,
      reason: "expired",
    });
    await db.close();
  });

  it("过期令牌拒绝且不落消费时间", async () => {
    const db = await dbFixture();
    const { token } = await issueOneTimeToken(db, {
      purpose: "bootstrap_admin",
      ttlMs: 1_000,
      now: () => clock,
    });
    const late = clock + 2_000;
    expect(
      await consumeOneTimeToken(db, { purpose: "bootstrap_admin", token, now: () => late }),
    ).toEqual({ ok: false, reason: "expired" });
    const row = (await db.get(
      "SELECT consumed_at AS \"consumedAt\" FROM one_time_token WHERE purpose = 'bootstrap_admin'",
    )) as { consumedAt: number | null };
    expect(row.consumedAt).toBeNull();
    await db.close();
  });

  it("未知或格式外的令牌一律 invalid,不区分存在性以外的信息", async () => {
    const db = await dbFixture();
    expect(await consumeOneTimeToken(db, { purpose: "enroll", token: mintTokenValue() })).toEqual({
      ok: false,
      reason: "invalid",
    });
    await db.close();
  });

  it("purpose 隔离:enroll 令牌不能消费 bootstrap_admin 槽位", async () => {
    const db = await dbFixture();
    const { token } = await issueOneTimeToken(db, {
      purpose: "enroll",
      ttlMs: 60_000,
      now: () => clock,
    });
    expect(
      await consumeOneTimeToken(db, { purpose: "bootstrap_admin", token, now: () => clock }),
    ).toEqual({ ok: false, reason: "invalid" });
    await db.close();
  });

  it("peek 只读不消费:可用→消费后不可用", async () => {
    const db = await dbFixture();
    const { token } = await issueOneTimeToken(db, {
      purpose: "bootstrap_admin",
      ttlMs: 60_000,
      now: () => clock,
    });
    expect(await peekOneTimeToken(db, { purpose: "bootstrap_admin", token, now: () => clock })).toEqual({
      usable: true,
    });
    expect(
      (await db.get("SELECT consumed_at AS c FROM one_time_token")) as { c: number | null },
    ).toEqual({ c: null });
    await consumeOneTimeToken(db, { purpose: "bootstrap_admin", token, now: () => clock });
    expect(await peekOneTimeToken(db, { purpose: "bootstrap_admin", token, now: () => clock })).toEqual({
      usable: false,
    });
    await db.close();
  });
});
