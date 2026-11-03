import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import { runMigrations } from "../migrator.js";
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

function prepare(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
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
  it("插入后可按 id 与流查到 running run", () => {
    const db = prepare();
    insertRun(db, newRun());

    expect(findRunById(db, "run_1")).toMatchObject({
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
    expect(findRunningRunForStream(db, "agt_a", "claude-session:s1")?.id).toBe("run_1");
    expect(findRunningRunForStream(db, "agt_a", "claude-session:s2")).toBeUndefined();
    db.close();
  });

  it("同一流不允许两条 running run", () => {
    const db = prepare();
    insertRun(db, newRun());
    expect(() => insertRun(db, newRun({ id: "run_2" }))).toThrow();
    db.close();
  });

  it("endRun 收尾后不再是当前 run", () => {
    const db = prepare();
    insertRun(db, newRun());

    expect(endRun(db, "run_1", 2_000)).toBe(true);
    expect(endRun(db, "run_1", 3_000)).toBe(false);
    expect(findRunningRunForStream(db, "agt_a", "claude-session:s1")).toBeUndefined();
    expect(findRunById(db, "run_1")).toMatchObject({ status: "ended", endedAt: 2_000 });
    db.close();
  });

  it("任务绑定只写一次", () => {
    const db = prepare();
    insertRun(db, newRun());

    expect(bindRunTaskIfEmpty(db, "run_1", "tsk_a")).toBe(true);
    expect(bindRunTaskIfEmpty(db, "run_1", "tsk_a")).toBe(false);
    expect(findRunById(db, "run_1")?.taskId).toBe("tsk_a");
    expect(bindRunTaskIfEmpty(db, "run_missing", "tsk_a")).toBe(false);
    db.close();
  });

  it("取最近活跃且未绑定任务的 running run,跳过空闲与已绑定", () => {
    const db = prepare();
    insertRun(db, newRun({ id: "run_1", streamId: "s1" }));
    insertRun(db, newRun({ id: "run_2", streamId: "s2" }));
    touchRunLastSeen(db, "run_1", 2_400);
    touchRunLastSeen(db, "run_2", 3_000);

    expect(findLatestUnboundRunningRunByAgent(db, "agt_a", 2_000)?.id).toBe("run_2");
    expect(bindRunTaskIfEmpty(db, "run_2", "tsk_a")).toBe(true);
    expect(findLatestUnboundRunningRunByAgent(db, "agt_a", 2_000)?.id).toBe("run_1");
    // 超出活跃窗口的 run 不再参与建单绑定
    expect(findLatestUnboundRunningRunByAgent(db, "agt_a", 2_500)).toBeUndefined();

    endRun(db, "run_1", 4_000);
    expect(findLatestUnboundRunningRunByAgent(db, "agt_a", 2_000)).toBeUndefined();
    db.close();
  });
});

describe("timeline_event 仓储", () => {
  it("按 occurred_at / ord 升序返回并保留块内最大新鲜度", () => {
    const db = prepare();
    insertRun(db, newRun());
    const base = {
      runId: "run_1",
      turnId: "turn_1",
      blockId: "blk_1",
      offset: null,
      kind: "assistant_text",
      payload: {},
    };
    insertTimelineEvent(db, {
      ...base,
      id: "tle_2",
      ord: 2,
      blockRev: 3,
      occurredAt: 1_200,
    });
    insertTimelineEvent(db, {
      ...base,
      id: "tle_1",
      ord: 1,
      blockRev: 1,
      occurredAt: 1_100,
    });

    expect(listTimelineEventsByRun(db, "run_1").map((event) => event.id)).toEqual([
      "tle_1",
      "tle_2",
    ]);
    expect(maxBlockRev(db, "run_1", "blk_1")).toBe(3);
    expect(maxBlockRev(db, "run_1", "blk_missing")).toBe(0);
    db.close();
  });

  it("同一 turn 内 ord 唯一", () => {
    const db = prepare();
    insertRun(db, newRun());
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
    insertTimelineEvent(db, { ...event, id: "tle_1" });
    expect(() => insertTimelineEvent(db, { ...event, id: "tle_2" })).toThrow();
    db.close();
  });
});
