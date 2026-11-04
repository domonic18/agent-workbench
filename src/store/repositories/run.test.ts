import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import {
  bindRunTaskIfEmpty,
  endRun,
  findLatestUnboundRunningRunByAgent,
  findRunById,
  findRunningRunForStream,
  insertRun,
  insertTimelineEvent,
  listTimelineEventsByRun,
  maxBlockRev,
  touchRunLastSeen,
  type NewAgentRun,
} from "./run.js";

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
  return db;
}

function newRun(overrides: Partial<NewAgentRun> = {}) {
  return {
    id: "run_1",
    agentId: "agt_a",
    machine: "m1",
    project: "pa",
    streamId: "claude-session:s1",
    startedAt: 1_000,
    ...overrides,
  };
}

describe("agent_run 仓储", () => {
  it("插入后可按 id 与流查到 running run", async () => {
    const db = await prepare();
    await insertRun(db, newRun());

    expect(await findRunById(db, "run_1")).toMatchObject({
      id: "run_1",
      agentId: "agt_a",
      machine: "m1",
      project: "pa",
      streamId: "claude-session:s1",
      taskId: null,
      status: "running",
      startedAt: 1_000,
      lastSeenAt: 1_000,
      endedAt: null,
    });
    expect((await findRunningRunForStream(db, "agt_a", "claude-session:s1"))?.id).toBe("run_1");
    expect(await findRunningRunForStream(db, "agt_a", "claude-session:s2")).toBeUndefined();
    await db.close();
  });

  it("同一流不允许两条 running run", async () => {
    const db = await prepare();
    await insertRun(db, newRun());
    await expect(insertRun(db, newRun({ id: "run_2" }))).rejects.toThrow();
    await db.close();
  });

  it("endRun 收尾后不再是当前 run", async () => {
    const db = await prepare();
    await insertRun(db, newRun());

    expect(await endRun(db, "run_1", 2_000)).toBe(true);
    expect(await endRun(db, "run_1", 3_000)).toBe(false);
    expect(await findRunningRunForStream(db, "agt_a", "claude-session:s1")).toBeUndefined();
    expect(await findRunById(db, "run_1")).toMatchObject({ status: "ended", endedAt: 2_000 });
    await db.close();
  });

  it("任务绑定只写一次", async () => {
    const db = await prepare();
    await insertRun(db, newRun());

    expect(await bindRunTaskIfEmpty(db, "run_1", "tsk_a")).toBe(true);
    expect(await bindRunTaskIfEmpty(db, "run_1", "tsk_a")).toBe(false);
    expect((await findRunById(db, "run_1"))?.taskId).toBe("tsk_a");
    expect(await bindRunTaskIfEmpty(db, "run_missing", "tsk_a")).toBe(false);
    await db.close();
  });

  it("取最近活跃且未绑定任务的 running run,跳过空闲与已绑定", async () => {
    const db = await prepare();
    await insertRun(db, newRun({ id: "run_1", streamId: "s1" }));
    await insertRun(db, newRun({ id: "run_2", streamId: "s2" }));
    await touchRunLastSeen(db, "run_1", 2_400);
    await touchRunLastSeen(db, "run_2", 3_000);

    expect((await findLatestUnboundRunningRunByAgent(db, "agt_a", 2_000))?.id).toBe("run_2");
    expect(await bindRunTaskIfEmpty(db, "run_2", "tsk_a")).toBe(true);
    expect((await findLatestUnboundRunningRunByAgent(db, "agt_a", 2_000))?.id).toBe("run_1");
    // 超出活跃窗口的 run 不再参与建单绑定
    expect(await findLatestUnboundRunningRunByAgent(db, "agt_a", 2_500)).toBeUndefined();

    await endRun(db, "run_1", 4_000);
    expect(await findLatestUnboundRunningRunByAgent(db, "agt_a", 2_000)).toBeUndefined();
    await db.close();
  });
});

describe("timeline_event 仓储", () => {
  it("按 occurred_at / ord 升序返回并保留块内最大新鲜度", async () => {
    const db = await prepare();
    await insertRun(db, newRun());
    const base = {
      runId: "run_1",
      turnId: "turn_1",
      blockId: "blk_1",
      offset: null,
      kind: "assistant_text",
      payload: {},
    };
    await insertTimelineEvent(db, {
      ...base,
      id: "tle_2",
      ord: 2,
      blockRev: 3,
      occurredAt: 1_200,
    });
    await insertTimelineEvent(db, {
      ...base,
      id: "tle_1",
      ord: 1,
      blockRev: 1,
      occurredAt: 1_100,
    });

    expect((await listTimelineEventsByRun(db, "run_1")).map((event) => event.id)).toEqual([
      "tle_1",
      "tle_2",
    ]);
    expect(await maxBlockRev(db, "run_1", "blk_1")).toBe(3);
    expect(await maxBlockRev(db, "run_1", "blk_missing")).toBe(0);
    await db.close();
  });

  it("同一 turn 内 ord 唯一", async () => {
    const db = await prepare();
    await insertRun(db, newRun());
    const event = {
      runId: "run_1",
      turnId: "turn_1",
      blockId: "blk_1",
      ord: 1,
      blockRev: 1,
      offset: null,
      kind: "assistant_text",
      payload: {},
      occurredAt: 1_100,
    };
    await insertTimelineEvent(db, { ...event, id: "tle_1" });
    await expect(insertTimelineEvent(db, { ...event, id: "tle_2" })).rejects.toThrow();
    await db.close();
  });
});
