import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import { runMigrations } from "../migrator.js";
import { insertThread, insertMessage, markAck } from "./a2a.js";
import { insertCapability } from "./capability.js";
import { insertAgent, insertMachine } from "./identity.js";
import { currentRevision } from "./revision.js";
import { bindRunTaskIfEmpty, insertRun } from "./run.js";
import { appendTaskEvent, insertTask } from "./task.js";
import { insertTokenUsage } from "./token-usage.js";

const AT = 1_700_000_000_000;

function seedIdentity(db: Db): void {
  insertMachine(db, {
    id: "m1",
    hostname: "host",
    os: "darwin",
    collectorVersion: "1.0.0",
    collectorSecretHash: "h",
    createdAt: AT,
  });
  insertAgent(db, {
    id: "a1",
    machineId: "m1",
    project: "p1",
    displayName: "A1",
    secretHash: "h",
    feishuAppId: null,
    allowedTargetsJson: '["a2"]',
    createdAt: AT,
  });
  insertAgent(db, {
    id: "a2",
    machineId: "m1",
    project: "p2",
    displayName: "A2",
    secretHash: "h",
    feishuAppId: null,
    allowedTargetsJson: "[]",
    createdAt: AT,
  });
}

function seedTask(db: Db, id: string): void {
  insertTask(db, {
    id,
    title: id,
    assigner: "human",
    assignee: "a1",
    project: "p1",
    parentTaskId: null,
    origin: "a2a",
    deadlineAt: null,
    output: null,
    createdAt: AT,
  });
}

function insertToken(db: Db, runId: string, taskId: string | null, sequence: number): void {
  insertTokenUsage(db, {
    id: `tu-${sequence}`,
    agentId: "a1",
    taskId,
    runId,
    provider: "anthropic",
    model: "claude",
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    source: "transcript",
    sequence,
    receiptHash: `h-${sequence}`,
    occurredAt: AT,
  });
}

describe("scope_revision", () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(":memory:");
    runMigrations(db);
    seedIdentity(db);
  });

  afterEach(() => {
    db.close();
  });

  it("未产生变更的作用域版本为 0", () => {
    expect(currentRevision(db, "task:none")).toBe(0);
    // 种子已写过 agent,overview 不再是 0
    expect(currentRevision(db, "overview")).toBeGreaterThan(0);
  });

  it("任务行同时推进 overview 与 task:<id>,任务事件只推进 task", () => {
    const overview = currentRevision(db, "overview");
    seedTask(db, "t1");
    expect(currentRevision(db, "overview")).toBe(overview + 1);
    expect(currentRevision(db, "task:t1")).toBe(1);

    appendTaskEvent(db, {
      id: "e1",
      taskId: "t1",
      kind: "created",
      payload: {},
      occurredAt: AT,
    });
    expect(currentRevision(db, "task:t1")).toBe(2);
    expect(currentRevision(db, "overview")).toBe(overview + 1);
  });

  it("token 归属任务时同时推进两个作用域,未归属时只推进 overview", () => {
    seedTask(db, "t1");
    insertRun(db, {
      id: "r1",
      agentId: "a1",
      machine: "m1",
      project: "p1",
      streamId: "s1",
      startedAt: AT,
    });
    const overview = currentRevision(db, "overview");
    const task = currentRevision(db, "task:t1");

    insertToken(db, "r1", null, 1);
    expect(currentRevision(db, "overview")).toBe(overview + 1);
    expect(currentRevision(db, "task:t1")).toBe(task);

    insertToken(db, "r1", "t1", 2);
    expect(currentRevision(db, "overview")).toBe(overview + 2);
    expect(currentRevision(db, "task:t1")).toBe(task + 1);
  });

  it("授权申请与状态变更同时推进 overview 与所属任务", () => {
    seedTask(db, "t1");
    const overview = currentRevision(db, "overview");
    const task = currentRevision(db, "task:t1");

    insertCapability(db, {
      id: "c1",
      subject: "a1",
      target: "db.prod",
      action: "read",
      scopeJson: "{}",
      ttlSeconds: 900,
      taskId: "t1",
      createdAt: AT,
    });
    expect(currentRevision(db, "overview")).toBe(overview + 1);
    expect(currentRevision(db, "task:t1")).toBe(task + 1);

    await db.run("UPDATE capability SET status = 'issuing' WHERE id = 'c1'");
    expect(currentRevision(db, "overview")).toBe(overview + 2);
    expect(currentRevision(db, "task:t1")).toBe(task + 2);
  });

  it("A2A 往返推进任务作用域,ACK 只记一次", () => {
    seedTask(db, "t1");
    insertThread(db, {
      id: "th1",
      initiatorTaskId: "t1",
      initiatorAgent: "a1",
      responderAgent: "a2",
      createdAt: AT,
    });
    const task = currentRevision(db, "task:t1");

    insertMessage(db, {
      id: "msg1",
      threadId: "th1",
      taskId: "t1",
      round: 1,
      replyToMsgId: null,
      fromAgent: "a1",
      toAgent: "a2",
      intent: "request",
      summary: "s",
      expect: "e",
      deadlineAt: null,
      refsJson: "[]",
      authTicket: null,
      createdAt: AT,
    });
    expect(currentRevision(db, "task:t1")).toBe(task + 1);

    expect(markAck(db, "msg1", AT)).toBe(true);
    expect(currentRevision(db, "task:t1")).toBe(task + 2);

    expect(markAck(db, "msg1", AT + 1)).toBe(false);
    expect(currentRevision(db, "task:t1")).toBe(task + 2);
  });

  it("run 与心跳推进 overview,任务绑定的 run 变化不单独推 task", () => {
    seedTask(db, "t1");
    const overview = currentRevision(db, "overview");
    const task = currentRevision(db, "task:t1");

    insertRun(db, {
      id: "r1",
      agentId: "a1",
      machine: "m1",
      project: "p1",
      streamId: "s1",
      startedAt: AT,
    });
    expect(currentRevision(db, "overview")).toBe(overview + 1);
    expect(currentRevision(db, "task:t1")).toBe(task);

    expect(bindRunTaskIfEmpty(db, "r1", "t1")).toBe(true);
    expect(currentRevision(db, "overview")).toBe(overview + 2);

    await db.run("UPDATE machine SET last_seen_at = ? WHERE id = 'm1'", AT + 1);
    expect(currentRevision(db, "overview")).toBe(overview + 3);
  });
});
