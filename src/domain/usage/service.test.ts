import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import {
  bindRunTaskIfEmpty,
  insertRun,
} from "../../store/repositories/run.js";
import { findTaskById } from "../../store/repositories/task.js";
import {
  findTokenUsageByKey,
  listTokenUsageByRun,
  setTaskTotalTokens,
} from "../../store/repositories/token-usage.js";
import { TokenUsageError } from "./errors.js";
import {
  createTokenUsageService,
  type TokenUsageInput,
  type TokenUsageService,
} from "./service.js";

function prepare(): { db: Db; service: TokenUsageService } {
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
  insertRun(db, {
    id: "run_1",
    agentId: "agt_a",
    machine: "m1",
    project: "pa",
    streamId: "s1",
    startedAt: 0,
  });
  insertRun(db, {
    id: "run_2",
    agentId: "agt_a",
    machine: "m1",
    project: "pa",
    streamId: "s2",
    startedAt: 0,
  });
  bindRunTaskIfEmpty(db, "run_1", "tsk_a");

  let idSeq = 0;
  const service = createTokenUsageService({ db, newId: () => `tku_${++idSeq}` });
  return { db, service };
}

function input(overrides: Partial<TokenUsageInput> = {}): TokenUsageInput {
  return {
    agentId: "agt_a",
    runId: "run_1",
    provider: "gateway",
    model: "gateway/GLM-5.3-flash",
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

describe("token 记账", () => {
  it("记录四维用量并按 run 归属任务,同步任务总量", () => {
    const { db, service } = prepare();

    expect(service.record(input())).toEqual({
      status: "recorded",
      id: "tku_1",
      taskId: "tsk_a",
    });
    expect(findTokenUsageByKey(db, "agt_a", "run_1", "assistant_message", 1)).toMatchObject({
      model: "gateway/GLM-5.3-flash",
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40,
      taskId: "tsk_a",
    });
    expect(findTaskById(db, "tsk_a")?.totalTokens).toBe(100);
    db.close();
  });

  it("同一 run 的多条事件累加到任务总量", () => {
    const { db, service } = prepare();
    service.record(input({ sequence: 1 }));
    service.record(
      input({
        sequence: 2,
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheCreationTokens: 4,
      }),
    );

    expect(findTaskById(db, "tsk_a")?.totalTokens).toBe(110);
    db.close();
  });

  it("未归属任务的 run 保留 task_id = NULL", () => {
    const { db, service } = prepare();
    const result = service.record(input({ runId: "run_2" }));

    expect(result).toMatchObject({ status: "recorded", taskId: null });
    expect(findTokenUsageByKey(db, "agt_a", "run_2", "assistant_message", 1)?.taskId).toBeNull();
    expect(findTaskById(db, "tsk_a")?.totalTokens).toBe(0);
    db.close();
  });

  it("同键同回执哈希幂等,不重复记账", () => {
    const { db, service } = prepare();
    service.record(input());

    expect(service.record(input())).toEqual({
      status: "duplicate",
      id: "tku_1",
      taskId: "tsk_a",
    });
    expect(listTokenUsageByRun(db, "run_1")).toHaveLength(1);
    expect(findTaskById(db, "tsk_a")?.totalTokens).toBe(100);
    db.close();
  });

  it("同键不同回执哈希报 CONFLICT", () => {
    const { db, service } = prepare();
    service.record(input());

    try {
      service.record(input({ receiptHash: "hash-2" }));
      throw new Error("预期抛出 CONFLICT");
    } catch (error) {
      expect(error).toBeInstanceOf(TokenUsageError);
      expect((error as TokenUsageError).code).toBe("CONFLICT");
    }
    expect(listTokenUsageByRun(db, "run_1")).toHaveLength(1);
    db.close();
  });

  it("<synthetic> 不入账", () => {
    const { db, service } = prepare();

    expect(service.record(input({ model: "<synthetic>" }))).toEqual({
      status: "skipped",
      reason: "synthetic",
    });
    expect(listTokenUsageByRun(db, "run_1")).toHaveLength(0);
    db.close();
  });

  it("run 不存在或与 agent 不匹配都拒绝", () => {
    const { service } = prepare();

    expect(() => service.record(input({ runId: "run_missing" }))).toThrowError(TokenUsageError);
    try {
      service.record(input({ agentId: "agt_b" }));
      throw new Error("预期抛出 VALIDATION_FAILED");
    } catch (error) {
      expect((error as TokenUsageError).code).toBe("VALIDATION_FAILED");
    }
  });

  it("负值 token 在写库前被拒绝", () => {
    const { db, service } = prepare();
    expect(() => service.record(input({ inputTokens: -1 }))).toThrowError(TokenUsageError);
    expect(listTokenUsageByRun(db, "run_1")).toHaveLength(0);
    db.close();
  });

  it("任务总量可重算并覆盖错误投影", () => {
    const { db, service } = prepare();
    service.record(input());
    setTaskTotalTokens(db, "tsk_a", 999);

    expect(service.recomputeTaskTotal("tsk_a")).toBe(100);
    expect(findTaskById(db, "tsk_a")?.totalTokens).toBe(100);
    expect(() => service.recomputeTaskTotal("tsk_missing")).toThrowError(TokenUsageError);
    db.close();
  });
});
