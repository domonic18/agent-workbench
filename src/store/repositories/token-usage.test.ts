import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import { findTaskById } from "./task.js";
import {
  findTokenUsageByKey,
  insertTokenUsage,
  listTokenUsageByRun,
  setTaskTotalTokens,
  sumTaskTokens,
  type NewTokenUsage,
} from "./token-usage.js";
import { bindRunTaskIfEmpty, insertRun } from "./run.js";

async function prepare(): Promise<Db> {
  const db = await openDatabase();
  await db.run(
    "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'hash', 'active', 0)",
  );
  await db.run(
    `INSERT INTO agent (id, machine_id, project, display_name, secret_hash, status, allowed_targets_json, created_at, updated_at)
     VALUES ('agt_a', 'm1', 'pa', 'agt_a', 'hash', 'active', '[]', 0, 0)`,
  );
  await db.run(
    `INSERT INTO task (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
     VALUES ('tsk_a', 'tsk_a', 'console', 'agt_a', 'aw', 'exec', 'running', 'a2a', 0, 0)`,
  );
  for (const streamId of ["s1", "s2"]) {
    await insertRun(db, {
      id: `run_${streamId}`,
      agentId: "agt_a",
      machine: "m1",
      project: "pa",
      streamId,
      startedAt: 0,
    });
  }
  await bindRunTaskIfEmpty(db, "run_s1", "tsk_a");
  return db;
}

function usage(overrides: Partial<NewTokenUsage> = {}): NewTokenUsage {
  return {
    id: "tku_1",
    agentId: "agt_a",
    taskId: "tsk_a",
    runId: "run_s1",
    provider: "zhipu",
    model: "glm-5.3-flash",
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheCreationTokens: 40,
    source: "assistant_message",
    sequence: 1,
    receiptHash: "hash-1",
    occurredAt: 1_000,
    ...overrides,
  };
}

describe("token_usage 仓储", () => {
  it("插入后按幂等键与 run 可查,四维原样保留", async () => {
    const db = await prepare();
    await insertTokenUsage(db, usage());

    expect(await findTokenUsageByKey(db, "agt_a", "run_s1", "assistant_message", 1)).toMatchObject({
      id: "tku_1",
      taskId: "tsk_a",
      provider: "zhipu",
      model: "glm-5.3-flash",
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40,
      receiptHash: "hash-1",
      occurredAt: 1_000,
    });
    expect(await listTokenUsageByRun(db, "run_s1")).toHaveLength(1);
    expect(await findTokenUsageByKey(db, "agt_a", "run_s2", "assistant_message", 1)).toBeUndefined();
    await db.close();
  });

  it("幂等键重复直接违反唯一约束", async () => {
    const db = await prepare();
    await insertTokenUsage(db, usage());
    await expect(insertTokenUsage(db, usage({ id: "tku_2" }))).rejects.toThrow();
    await db.close();
  });

  it("任务总量为四维之和,未归属的行不计入", async () => {
    const db = await prepare();
    await insertTokenUsage(db, usage({ id: "tku_1", sequence: 1 }));
    await insertTokenUsage(
      db,
      usage({
        id: "tku_2",
        sequence: 2,
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheCreationTokens: 4,
      }),
    );
    await insertTokenUsage(
      db,
      usage({ id: "tku_3", runId: "run_s2", taskId: null, sequence: 1, inputTokens: 999 }),
    );

    expect(await sumTaskTokens(db, "tsk_a")).toBe(110);
    expect(await sumTaskTokens(db, "tsk_missing")).toBe(0);

    expect(await setTaskTotalTokens(db, "tsk_a", 110)).toBe(true);
    expect((await findTaskById(db, "tsk_a"))?.totalTokens).toBe(110);
    expect(await setTaskTotalTokens(db, "tsk_missing", 1)).toBe(false);
    await db.close();
  });
});
