import { describe, expect, it } from "vitest";
import { RUN_IDLE_GAP_MS } from "../../shared/constants.js";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import {
  findRunById,
  findRunningRunForStream,
  listTimelineEventsByRun,
} from "../../store/repositories/run.js";
import { createRunService, type RecordEventInput, type RunService } from "./service.js";

function prepare(): { db: Db; service: RunService } {
  const db = openDatabase(":memory:");
  runMigrations(db);
  db.prepare(
    "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'hash', 'active', 0)",
  ).run();
  db.prepare(
    `INSERT INTO agent (id, machine_id, project, display_name, secret_hash, status, allowed_targets_json, created_at, updated_at)
     VALUES ('agt_a', 'm1', 'pa', 'agt_a', 'hash', 'active', '[]', 0, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO task (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
     VALUES ('tsk_a', 'tsk_a', 'console', 'agt_a', 'aw', 'exec', 'running', 'a2a', 0, 0)`,
  ).run();
  let runSeq = 0;
  let eventSeq = 0;
  const service = createRunService({
    db,
    now: () => 9_999_999,
    newRunId: () => `run_${++runSeq}`,
    newEventId: () => `tle_${++eventSeq}`,
  });
  return { db, service };
}

function eventInput(overrides: Partial<RecordEventInput> = {}): RecordEventInput {
  return {
    agentId: "agt_a",
    machine: "m1",
    project: "pa",
    streamId: "claude-session:s1",
    kind: "turn",
    occurredAt: 1_000,
    ord: 1,
    ...overrides,
  };
}

describe("run 记录事件", () => {
  it("首个事件开出 running run 并落时间线", () => {
    const { db, service } = prepare();

    const result = service.recordEvent(
      eventInput({
        turnId: "turn_1",
        blockId: "blk_1",
        offset: 0,
        payload: { text: "hello" },
      }),
    );

    expect(result).toEqual({
      runId: "run_1",
      eventId: "tle_1",
      startedRun: true,
      staleRev: false,
    });
    expect(findRunById(db, "run_1")).toMatchObject({
      agentId: "agt_a",
      machine: "m1",
      project: "pa",
      streamId: "claude-session:s1",
      status: "running",
      startedAt: 1_000,
      lastSeenAt: 1_000,
      endedAt: null,
    });
    expect(listTimelineEventsByRun(db, "run_1")).toMatchObject([
      {
        id: "tle_1",
        turnId: "turn_1",
        blockId: "blk_1",
        ord: 1,
        blockRev: 1,
        offset: 0,
        kind: "turn",
        payloadJson: '{"text":"hello"}',
        occurredAt: 1_000,
      },
    ]);
    db.close();
  });

  it("同一流复用 run 并推进 last_seen_at", () => {
    const { db, service } = prepare();
    service.recordEvent(eventInput({ occurredAt: 1_000, ord: 1 }));
    const result = service.recordEvent(eventInput({ occurredAt: 2_000, ord: 2 }));

    expect(result.startedRun).toBe(false);
    expect(result.runId).toBe("run_1");
    expect(findRunById(db, "run_1")?.lastSeenAt).toBe(2_000);
    expect(listTimelineEventsByRun(db, "run_1")).toHaveLength(2);
    db.close();
  });

  it("空闲满 30 分钟切分新 run,旧 run 停在最后一次活动", () => {
    const { db, service } = prepare();
    service.recordEvent(eventInput({ occurredAt: 1_000, ord: 1 }));

    const result = service.recordEvent(
      eventInput({ occurredAt: 1_000 + RUN_IDLE_GAP_MS, ord: 2 }),
    );

    expect(result).toMatchObject({ runId: "run_2", startedRun: true });
    expect(findRunById(db, "run_1")).toMatchObject({ status: "ended", endedAt: 1_000 });
    expect(findRunById(db, "run_2")).toMatchObject({
      status: "running",
      startedAt: 1_000 + RUN_IDLE_GAP_MS,
      lastSeenAt: 1_000 + RUN_IDLE_GAP_MS,
    });
    expect(findRunningRunForStream(db, "agt_a", "claude-session:s1")?.id).toBe("run_2");
    db.close();
  });

  it("未满 30 分钟不切分", () => {
    const { db, service } = prepare();
    service.recordEvent(eventInput({ occurredAt: 1_000, ord: 1 }));
    const result = service.recordEvent(
      eventInput({ occurredAt: 1_000 + RUN_IDLE_GAP_MS - 1, ord: 2 }),
    );

    expect(result).toMatchObject({ runId: "run_1", startedRun: false });
    expect(findRunById(db, "run_1")?.status).toBe("running");
    db.close();
  });

  it("同 Agent 的不同流各成一段 run", () => {
    const { db, service } = prepare();
    service.recordEvent(eventInput({ occurredAt: 1_000, ord: 1 }));
    const other = service.recordEvent(
      eventInput({ streamId: "claude-session:s2", occurredAt: 1_001, ord: 1 }),
    );

    expect(other).toMatchObject({ runId: "run_2", startedRun: true });
    expect(findRunningRunForStream(db, "agt_a", "claude-session:s1")?.id).toBe("run_1");
    expect(findRunningRunForStream(db, "agt_a", "claude-session:s2")?.id).toBe("run_2");
    db.close();
  });

  it("晚到事件不切分也不回拨 last_seen_at", () => {
    const { db, service } = prepare();
    service.recordEvent(eventInput({ occurredAt: 5_000, ord: 2 }));
    const late = service.recordEvent(eventInput({ occurredAt: 1_000, ord: 1 }));

    expect(late).toMatchObject({ runId: "run_1", startedRun: false, staleRev: false });
    expect(findRunById(db, "run_1")).toMatchObject({ startedAt: 5_000, lastSeenAt: 5_000 });
    expect(listTimelineEventsByRun(db, "run_1").map((event) => event.ord)).toEqual([1, 2]);
    db.close();
  });
});

describe("block_rev 新鲜度", () => {
  it("旧 block_rev 被丢弃,不回写新内容", () => {
    const { db, service } = prepare();
    service.recordEvent(
      eventInput({ occurredAt: 1_000, ord: 1, blockId: "blk_1", blockRev: 2 }),
    );

    const stale = service.recordEvent(
      eventInput({ occurredAt: 2_000, ord: 2, blockId: "blk_1", blockRev: 1 }),
    );

    expect(stale).toEqual({
      runId: "run_1",
      eventId: null,
      startedRun: false,
      staleRev: true,
    });
    expect(listTimelineEventsByRun(db, "run_1")).toHaveLength(1);
    // 事件被丢弃,但它仍是 run 存活的证据
    expect(findRunById(db, "run_1")?.lastSeenAt).toBe(2_000);
    db.close();
  });

  it("更新的 block_rev 正常写入", () => {
    const { db, service } = prepare();
    service.recordEvent(
      eventInput({ occurredAt: 1_000, ord: 1, blockId: "blk_1", blockRev: 2 }),
    );
    const next = service.recordEvent(
      eventInput({ occurredAt: 2_000, ord: 2, blockId: "blk_1", blockRev: 3 }),
    );

    expect(next.staleRev).toBe(false);
    expect(listTimelineEventsByRun(db, "run_1")).toHaveLength(2);
    db.close();
  });
});

describe("run 收尾与任务绑定", () => {
  it("endStream 收尾当前 run,重复调用返回 null", () => {
    const { db, service } = prepare();
    service.recordEvent(eventInput({ occurredAt: 1_000, ord: 1 }));

    expect(service.endStream("agt_a", "claude-session:s1", 2_000)).toBe("run_1");
    expect(findRunById(db, "run_1")).toMatchObject({ status: "ended", endedAt: 2_000 });
    expect(service.endStream("agt_a", "claude-session:s1", 3_000)).toBeNull();
    db.close();
  });

  it("一个 run 只绑定一次任务", () => {
    const { db, service } = prepare();
    service.recordEvent(eventInput({ occurredAt: 1_000, ord: 1 }));

    expect(service.bindTask("run_1", "tsk_a")).toBe(true);
    expect(service.bindTask("run_1", "tsk_a")).toBe(false);
    expect(findRunById(db, "run_1")?.taskId).toBe("tsk_a");
    db.close();
  });

  it("非法坐标在开 run 之前就被拒绝", () => {
    const { db, service } = prepare();

    expect(() => service.recordEvent(eventInput({ ord: 0 }))).toThrow("ord");
    expect(findRunningRunForStream(db, "agt_a", "claude-session:s1")).toBeUndefined();
    db.close();
  });
});
