import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import { insertAgent, type NewAgent } from "./agent.js";
import {
  deleteUsageLimit,
  findUsageLimitByAgentId,
  findUsageLimitsByAgentIds,
  upsertUsageLimit,
} from "./usage-limit.js";

const AGENT: NewAgent = {
  id: "agt_a",
  machineId: null,
  runtime: "workbuddy",
  project: "demo",
  displayName: "A",
  secretHash: null,
  feishuAppId: null,
  allowedTargetsJson: "[]",
  key: null,
  createdAt: 1,
};

async function prepare(): Promise<Db> {
  const db = await openDatabase();
  await insertAgent(db, AGENT);
  return db;
}

describe("usage_limit repository", () => {
  it("find 无行返回 undefined", async () => {
    const db = await prepare();
    expect(await findUsageLimitByAgentId(db, "agt_a")).toBeUndefined();
    await db.close();
  });

  it("upsert 插入与更新,find 回读", async () => {
    const db = await prepare();
    await upsertUsageLimit(db, {
      agentId: "agt_a",
      dailyTokenLimit: 1000,
      warnPercent: 80,
      hardStop: true,
      isActive: true,
      updatedAt: 2,
    });
    const first = await findUsageLimitByAgentId(db, "agt_a");
    expect(first).toMatchObject({
      agentId: "agt_a",
      dailyTokenLimit: 1000,
      warnPercent: 80,
      hardStop: true,
      isActive: true,
      updatedAt: 2,
    });

    await upsertUsageLimit(db, {
      agentId: "agt_a",
      dailyTokenLimit: 2000,
      warnPercent: 90,
      hardStop: false,
      isActive: false,
      updatedAt: 3,
    });
    const second = await findUsageLimitByAgentId(db, "agt_a");
    expect(second).toMatchObject({
      dailyTokenLimit: 2000,
      warnPercent: 90,
      hardStop: false,
      isActive: false,
      updatedAt: 3,
    });
    await db.close();
  });

  it("delete 删除指定行", async () => {
    const db = await prepare();
    await upsertUsageLimit(db, {
      agentId: "agt_a",
      dailyTokenLimit: 100,
      warnPercent: 80,
      hardStop: true,
      isActive: true,
      updatedAt: 1,
    });
    expect(await deleteUsageLimit(db, "agt_a")).toBe(true);
    expect(await findUsageLimitByAgentId(db, "agt_a")).toBeUndefined();
    expect(await deleteUsageLimit(db, "agt_a")).toBe(false);
    await db.close();
  });

  it("Agent 删除级联删除 usage_limit", async () => {
    const db = await prepare();
    await upsertUsageLimit(db, {
      agentId: "agt_a",
      dailyTokenLimit: 100,
      warnPercent: 80,
      hardStop: true,
      isActive: true,
      updatedAt: 1,
    });
    await db.run("DELETE FROM agent WHERE id = ?", "agt_a");
    expect(await findUsageLimitByAgentId(db, "agt_a")).toBeUndefined();
    await db.close();
  });

  it("findUsageLimitsByAgentIds 批量返回 Map,无行缺失", async () => {
    const db = await prepare();
    await insertAgent(db, { ...AGENT, id: "agt_b" });
    await upsertUsageLimit(db, {
      agentId: "agt_a",
      dailyTokenLimit: 100,
      warnPercent: 80,
      hardStop: true,
      isActive: true,
      updatedAt: 1,
    });
    const map = await findUsageLimitsByAgentIds(db, ["agt_a", "agt_b", "agt_missing"]);
    expect(map.size).toBe(1);
    expect(map.get("agt_a")?.dailyTokenLimit).toBe(100);
    expect(map.has("agt_b")).toBe(false);
    expect(map.has("agt_missing")).toBe(false);
    await db.close();
  });
});
