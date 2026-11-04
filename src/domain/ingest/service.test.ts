import { describe, expect, it } from "vitest";
import { createIdentityService } from "../identity/service.js";
import { createRunService, type RunService } from "../run/service.js";
import { openDatabase, type Db } from "../../store/database.js";
import { hasIngestReceipt } from "../../store/repositories/ingest-receipt.js";
import { findRunningRunForStream, listTimelineEventsByRun } from "../../store/repositories/run.js";
import { findTaskById } from "../../store/repositories/task.js";
import { listTokenUsageByRun } from "../../store/repositories/token-usage.js";
import { IngestError } from "./errors.js";
import { createIngestService, type IngestBatchInput, type IngestService } from "./service.js";

interface Fixture {
  db: Db;
  service: IngestService;
  runService: RunService;
  agentId: string;
}

async function prepare(): Promise<Fixture> {
  const db = await openDatabase();
  const identity = createIdentityService({ db });
  await identity.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
  const agent = await identity.registerAgent({ machineId: "m1", project: "pa", displayName: "A" });

  // run/token 服务不注入:ingest 在事务内以 tx 重建服务,保证事件、用量与回执同事务域
  const runService = createRunService({ db });
  const service = createIngestService({ db, now: () => 8_888_888 });
  return { db, service, runService, agentId: agent.agent.id };
}

function batch(seqs: number[], overrides: Partial<IngestBatchInput> = {}): IngestBatchInput {
  return {
    collectorId: "m1",
    agentProject: "pa",
    streamId: "claude-session:s1",
    items: seqs.map((seq) => ({
      seq,
      kind: "turn",
      occurredAt: 1_000 + seq,
      payload: { ord: seq },
    })),
    ...overrides,
  };
}

function tokenItem(seq: number, payload: Record<string, unknown>) {
  return {
    seq,
    kind: "token_usage",
    occurredAt: 1_000 + seq,
    payload: { ord: seq, ...payload },
  };
}

const TOKEN_PAYLOAD = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  input_tokens: 10,
  output_tokens: 20,
  cache_read_tokens: 3,
  cache_creation_tokens: 4,
};

describe("采集入库", () => {
  it("事件落时间线与回执,返回已确认的最大 seq", async () => {
    const { db, service, agentId } = await prepare();

    const result = await service.ingestBatch(batch([1, 2]));

    expect(result).toEqual({ ackedSeq: 2, processed: 2, skipped: 0, failed: null });
    const run = await findRunningRunForStream(db, agentId, "claude-session:s1");
    expect(run).toBeDefined();
    const events = await listTimelineEventsByRun(db, run!.id);
    expect(events.map((event) => event.ord)).toEqual([1, 2]);
    expect(
      await hasIngestReceipt(db, { collectorId: "m1", streamId: "claude-session:s1", seq: 2 }),
    ).toBe(true);
    await db.close();
  });

  it("重放同一批次全部跳过,不重复落事件", async () => {
    const { db, service, agentId } = await prepare();
    await service.ingestBatch(batch([1, 2]));

    const replay = await service.ingestBatch(batch([1, 2]));

    expect(replay).toEqual({ ackedSeq: 2, processed: 0, skipped: 2, failed: null });
    const run = await findRunningRunForStream(db, agentId, "claude-session:s1");
    expect(await listTimelineEventsByRun(db, run!.id)).toHaveLength(2);
    await db.close();
  });

  it("token_usage 事件入账,四维之和投影到任务总量", async () => {
    const { db, service, runService, agentId } = await prepare();
    await service.ingestBatch(batch([1]));

    const run = (await findRunningRunForStream(db, agentId, "claude-session:s1"))!;
    await db.run(
      `INSERT INTO task (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
       VALUES ('tsk_a', 'tsk_a', 'console', 'agt_a', 'aw', 'exec', 'running', 'a2a', 0, 0)`,
    );
    expect(await runService.bindTask(run.id, "tsk_a")).toBe(true);

    const result = await service.ingestBatch(
      batch([], { items: [tokenItem(2, TOKEN_PAYLOAD)] }),
    );

    expect(result).toEqual({ ackedSeq: 2, processed: 1, skipped: 0, failed: null });
    expect(await listTokenUsageByRun(db, run.id)).toMatchObject([
      { sequence: 2, source: "assistant_message", taskId: "tsk_a", inputTokens: 10 },
    ]);
    expect((await findTaskById(db, "tsk_a"))?.totalTokens).toBe(37);
    await db.close();
  });

  it("未登记或已停用的 agent_project 整批 400,不落任何回执", async () => {
    const { db, service } = await prepare();

    await expect(service.ingestBatch(batch([1], { agentProject: "nope" }))).rejects.toThrow(IngestError);
    expect(
      await hasIngestReceipt(db, { collectorId: "m1", streamId: "claude-session:s1", seq: 1 }),
    ).toBe(false);
    await db.close();
  });

  it("首个失败项处停止,此前已提交的事件保留且回执到位", async () => {
    const { db, service, agentId } = await prepare();
    const result = await service.ingestBatch(
      batch([], {
        items: [
          { seq: 1, kind: "turn", occurredAt: 1_001, payload: { ord: 1 } },
          tokenItem(2, { model: "claude-sonnet-4-6" }),
          { seq: 3, kind: "turn", occurredAt: 1_003, payload: { ord: 3 } },
        ],
      }),
    );

    expect(result.ackedSeq).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.failed).toMatchObject({ seq: 2 });
    const run = (await findRunningRunForStream(db, agentId, "claude-session:s1"))!;
    expect(await listTimelineEventsByRun(db, run.id)).toHaveLength(1);
    expect(
      await hasIngestReceipt(db, { collectorId: "m1", streamId: "claude-session:s1", seq: 2 }),
    ).toBe(false);
    expect(
      await hasIngestReceipt(db, { collectorId: "m1", streamId: "claude-session:s1", seq: 3 }),
    ).toBe(false);
    await db.close();
  });

  it("失败项的写入整体回滚,不留半条 run 或时间线", async () => {
    const { db, service, agentId } = await prepare();
    const result = await service.ingestBatch(
      batch([], { items: [tokenItem(1, { model: "claude-sonnet-4-6" })] }),
    );

    expect(result.processed).toBe(0);
    expect(result.ackedSeq).toBe(0);
    expect(await findRunningRunForStream(db, agentId, "claude-session:s1")).toBeUndefined();
    await db.close();
  });
});
