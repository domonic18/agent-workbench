import { describe, expect, it } from "vitest";
import { createUsageResolver } from "./state.js";
import { openDatabase, type Db } from "../../store/database.js";
import { insertAgent, type NewAgent } from "../../store/repositories/agent.js";
import { insertRun } from "../../store/repositories/run.js";
import { insertTokenUsage } from "../../store/repositories/token-usage.js";
import { upsertUsageLimit } from "../../store/repositories/usage-limit.js";

const AGENT: NewAgent = {
  id: "agt_u",
  machineId: "m1",
  runtime: "claude_code",
  project: "demo",
  displayName: "U",
  secretHash: null,
  feishuAppId: null,
  allowedTargetsJson: "[]",
  key: null,
  createdAt: 1,
};

async function prepare(at: number): Promise<{ db: Db; now: () => number }> {
  const db = await openDatabase();
  await db.run(
    "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'hash', 'active', 0)",
  );
  await insertAgent(db, AGENT);
  await insertRun(db, {
    id: "run_1",
    agentId: "agt_u",
    machine: "m1",
    project: "demo",
    streamId: "s1",
    startedAt: 1,
  });
  return { db, now: () => at };
}

function addUsage(
  db: Db,
  id: string,
  agentId: string,
  occurredAt: number,
  total: number,
  sequence = 1,
): Promise<void> {
  return insertTokenUsage(db, {
    id,
    agentId,
    taskId: null,
    runId: "run_1",
    provider: "anthropic",
    model: "claude",
    inputTokens: total,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    source: "transcript",
    sequence,
    receiptHash: `h-${id}`,
    occurredAt,
  });
}

describe("usage state resolver", () => {
  it("无上限行返回 unlimited", async () => {
    const { db, now } = await prepare(1_000);
    const resolver = createUsageResolver({ now });
    expect(await resolver.resolve(db, "agt_u")).toEqual({ kind: "unlimited" });
    await db.close();
  });

  it("isActive=false 返回 unlimited", async () => {
    const { db, now } = await prepare(1_000);
    await upsertUsageLimit(db, {
      agentId: "agt_u",
      dailyTokenLimit: 100,
      warnPercent: 80,
      hardStop: true,
      isActive: false,
      updatedAt: 1,
    });
    const resolver = createUsageResolver({ now });
    expect(await resolver.resolve(db, "agt_u")).toEqual({ kind: "unlimited" });
    await db.close();
  });

  it("hardStop=false 时仍返回 metered 但不触发拦截", async () => {
    const { db, now } = await prepare(1_000);
    await upsertUsageLimit(db, {
      agentId: "agt_u",
      dailyTokenLimit: 100,
      warnPercent: 80,
      hardStop: false,
      isActive: true,
      updatedAt: 1,
    });
    await addUsage(db, "tu_1", "agt_u", 500, 150);
    const resolver = createUsageResolver({ now });
    expect(await resolver.resolve(db, "agt_u")).toEqual({
      kind: "metered",
      usedTokens: 150,
      dailyLimit: 100,
      hardStop: false,
    });
    await db.close();
  });

  it("未达上限返回 metered", async () => {
    const { db, now } = await prepare(1_000);
    await upsertUsageLimit(db, {
      agentId: "agt_u",
      dailyTokenLimit: 100,
      warnPercent: 80,
      hardStop: true,
      isActive: true,
      updatedAt: 1,
    });
    await addUsage(db, "tu_1", "agt_u", 500, 60);
    const resolver = createUsageResolver({ now });
    expect(await resolver.resolve(db, "agt_u")).toEqual({
      kind: "metered",
      usedTokens: 60,
      dailyLimit: 100,
      hardStop: true,
    });
    await db.close();
  });

  it("达上限返回 metered(usedTokens >= dailyLimit)", async () => {
    const { db, now } = await prepare(1_000);
    await upsertUsageLimit(db, {
      agentId: "agt_u",
      dailyTokenLimit: 100,
      warnPercent: 80,
      hardStop: true,
      isActive: true,
      updatedAt: 1,
    });
    await addUsage(db, "tu_1", "agt_u", 500, 100);
    const resolver = createUsageResolver({ now });
    expect(await resolver.resolve(db, "agt_u")).toEqual({
      kind: "metered",
      usedTokens: 100,
      dailyLimit: 100,
      hardStop: true,
    });
    await db.close();
  });

  it("只统计今日(本地日零点起),跨天清零", async () => {
    const at = new Date("2026-11-06T12:00:00").getTime();
    const { db, now } = await prepare(at);
    const todayStart = new Date("2026-11-06T00:00:00").getTime();
    await upsertUsageLimit(db, {
      agentId: "agt_u",
      dailyTokenLimit: 100,
      warnPercent: 80,
      hardStop: true,
      isActive: true,
      updatedAt: 1,
    });
    await addUsage(db, "tu_today", "agt_u", todayStart + 1, 60);
    await addUsage(db, "tu_yesterday", "agt_u", todayStart - 1, 999, 2);
    const resolver = createUsageResolver({ now });
    expect(await resolver.resolve(db, "agt_u")).toEqual({
      kind: "metered",
      usedTokens: 60,
      dailyLimit: 100,
      hardStop: true,
    });
    await db.close();
  });

  it("读失败返回 unavailable", async () => {
    const { db, now } = await prepare(1_000);
    await upsertUsageLimit(db, {
      agentId: "agt_u",
      dailyTokenLimit: 100,
      warnPercent: 80,
      hardStop: true,
      isActive: true,
      updatedAt: 1,
    });
    const badDb = {
      ...db,
      get: async () => {
        throw new Error("boom");
      },
    } as unknown as Db;
    const resolver = createUsageResolver({ now });
    const state = await resolver.resolve(badDb, "agt_u");
    expect(state).toMatchObject({ kind: "unavailable", reason: "boom" });
    await db.close();
  });
});
