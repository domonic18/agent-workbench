import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertTokenUsage, sumAgentTokensSince, summarizeTaskTokens } from "../../store/repositories/token-usage.js";
import { rollupTokenUsageBefore, deleteTimelineEventsIngestedBefore } from "../../store/repositories/telemetry-cleanup.js";
import { startTelemetryRetention } from "./telemetry-retention.js";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

async function prepare(): Promise<Db> {
  const db = await openDatabase();
  await db.run(
    "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'hash', 'active', 0)",
  );
  await db.run(
    `INSERT INTO agent (id, machine_id, runtime, project, display_name, secret_hash, allowed_targets_json, created_at, updated_at, bootstrap_status)
     VALUES ('agt_x', 'm1', 'claude_code', 'p', '甲', 'h', '[]', 0, 0, 'registered')`,
  );
  await db.run(
    `INSERT INTO agent_run (id, agent_id, machine, project, stream_id, started_at, last_seen_at, status)
     VALUES ('run_1', 'agt_x', 'm1', 'p', 'claude-session:s', 0, 0, 'running')`,
  );
  await db.run(
    `INSERT INTO task (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
     VALUES ('tsk_1', 't', 'agt_x', 'agt_x', 'p', 'closed', 'done', 'a2a', 0, 0)`,
  );
  return db;
}

let usageSeq = 0;

async function insertUsage(
  db: Db,
  args: { occurredAt: number; input: number; taskId: string | null },
): Promise<void> {
  usageSeq += 1;
  await insertTokenUsage(db, {
    id: `tu_${usageSeq}`,
    agentId: "agt_x",
    taskId: args.taskId,
    runId: "run_1",
    provider: "anthropic",
    model: "claude",
    inputTokens: args.input,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    source: "timeline",
    sequence: usageSeq,
    receiptHash: `h${usageSeq}`,
    occurredAt: args.occurredAt,
  });
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

describe("startTelemetryRetention", () => {
  it("明细过窗聚合进日表并删除,视图总量不变、任务口径可对账", async () => {
    const db = await prepare();
    // 三天前的两笔(将聚合)+ 昨天的一笔(留明细)
    await insertUsage(db, { occurredAt: NOW - 3 * DAY, input: 100, taskId: "tsk_1" });
    await insertUsage(db, { occurredAt: NOW - 3 * DAY + 1000, input: 50, taskId: null });
    await insertUsage(db, { occurredAt: NOW - 1 * DAY, input: 7, taskId: "tsk_1" });
    const before = Number(await sumAgentTokensSince(db, "agt_x", 0));

    const log = logger();
    const sweeper = startTelemetryRetention(db, log, {
      now: () => NOW,
      timelineRetentionMs: 30 * DAY,
      tokenUsageRawRetentionMs: 2 * DAY,
      intervalMs: 60_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const after = Number(await sumAgentTokensSince(db, "agt_x", 0));
    expect(after).toBe(before);
    // 明细只剩窗口内那一笔;日表承接了旧的两笔
    const rawLeft = Number(
      (await db.get("SELECT COUNT(*) AS n FROM token_usage") as { n: number }).n,
    );
    expect(rawLeft).toBe(1);
    const daily = Number(
      (await db.get("SELECT COALESCE(SUM(entries), 0) AS n FROM token_usage_daily") as { n: number }).n,
    );
    expect(daily).toBe(2);
    // 任务口径:聚合后老任务的用量不丢
    const summary = await summarizeTaskTokens(db, "tsk_1");
    expect({ total: Number(summary.total), entries: Number(summary.entries) }).toEqual({
      total: 107,
      entries: 2,
    });
    sweeper.stop();
    await db.close();
  });

  it("重复扫不会重复计数(聚合与删除同事务)", async () => {
    const db = await prepare();
    await insertUsage(db, { occurredAt: NOW - 3 * DAY, input: 100, taskId: null });

    const sweeper = startTelemetryRetention(db, logger(), {
      now: () => NOW,
      tokenUsageRawRetentionMs: 2 * DAY,
      intervalMs: 60_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    sweeper.stop();

    const sweeper2 = startTelemetryRetention(db, logger(), {
      now: () => NOW,
      tokenUsageRawRetentionMs: 2 * DAY,
      intervalMs: 60_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    sweeper2.stop();

    expect(Number(await sumAgentTokensSince(db, "agt_x", 0))).toBe(100);
    await db.close();
  });

  it("分批推进:批次小于全量也能清完,且不重复计数", async () => {
    const db = await prepare();
    // 5 笔旧明细,batchMax=2 → 3 轮(2+2+1),聚合值必须恰好等于原值
    for (let i = 0; i < 5; i += 1) {
      await insertUsage(db, { occurredAt: NOW - 3 * DAY, input: 10, taskId: null });
    }

    const { groups } = await rollupTokenUsageBefore(db, NOW - 2 * DAY, NOW, 2);

    expect(groups).toBe(1); // 同一天同一维度 → 聚合出一行
    const daily = Number(
      (await db.get("SELECT COALESCE(SUM(entries), 0) AS n FROM token_usage_daily") as { n: number }).n,
    );
    const rawLeft = Number(
      (await db.get("SELECT COUNT(*) AS n FROM token_usage") as { n: number }).n,
    );
    expect(daily).toBe(5);
    expect(rawLeft).toBe(0);
    expect(Number(await sumAgentTokensSince(db, "agt_x", 0))).toBe(50);
    await db.close();
  });

  it("时间线删除分批推进:跨批次删干净", async () => {
    const db = await prepare();
    await db.run(
      `UPDATE agent_run SET status = 'ended', ended_at = 1 WHERE id = 'run_1'`,
    );
    for (let i = 1; i <= 5; i += 1) {
      await db.run(
        `INSERT INTO timeline_event (id, run_id, kind, ord, occurred_at, ingested_at, payload_json)
         VALUES (?, 'run_1', 'user_message', ?, 1, 1, '{}')`,
        `tle_b${i}`,
        i,
      );
    }

    const deleted = await deleteTimelineEventsIngestedBefore(db, NOW, 2);

    expect(deleted).toBe(5);
    const left = Number(
      (await db.get("SELECT COUNT(*) AS n FROM timeline_event") as { n: number }).n,
    );
    expect(left).toBe(0);
    await db.close();
  });

  it("孤立 run 随时间线清理一起删除", async () => {
    const db = await prepare();
    // run_1 已 running(未结束) = 不应删
    // 再建一个已结束、无事件、无用量的孤立 run
    await db.run(
      `INSERT INTO agent_run (id, agent_id, machine, project, stream_id, started_at, last_seen_at, ended_at, status)
       VALUES ('run_old', 'agt_x', 'm1', 'p', 'claude-session:s', 1, 1, 1, 'ended')`,
    );

    const sweeper = startTelemetryRetention(db, logger(), {
      now: () => NOW,
      timelineRetentionMs: 2 * DAY,
      tokenUsageRawRetentionMs: 365 * DAY,
      intervalMs: 60_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    sweeper.stop();

    const left = (await db.all("SELECT id FROM agent_run ORDER BY id") as { id: string }[]).map(
      (row) => row.id,
    );
    expect(left).toEqual(["run_1"]);
    await db.close();
  });
});
