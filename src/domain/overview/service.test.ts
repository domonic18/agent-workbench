import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MACHINE_HEARTBEAT,
  RUN_IDLE_GAP_MS,
} from "../../shared/constants.js";
import { OVERVIEW_SCOPE } from "../../shared/scopes.js";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { insertCapability } from "../../store/repositories/capability.js";
import { insertAgent, insertMachine } from "../../store/repositories/identity.js";
import { currentRevision } from "../../store/repositories/revision.js";
import {
  bindRunTaskIfEmpty,
  insertRun,
  insertTimelineEvent,
} from "../../store/repositories/run.js";
import { insertTask, updateTask } from "../../store/repositories/task.js";
import { insertTokenUsage } from "../../store/repositories/token-usage.js";
import { createOverviewService, heartbeatState, startOfLocalDay } from "./service.js";

const AT = 1_700_000_000_000;

function addMachine(db: Db, id: string, lastSeenAt: number | null): void {
  insertMachine(db, {
    id,
    hostname: `${id}.example.com`,
    os: "darwin",
    collectorVersion: "1.0.0",
    collectorSecretHash: "h",
    createdAt: AT,
  });
  if (lastSeenAt !== null) {
    await db.run("UPDATE machine SET last_seen_at = ? WHERE id = ?", lastSeenAt, id);
  }
}

function addAgent(db: Db, id: string, machineId: string, disabled = false): void {
  insertAgent(db, {
    id,
    machineId,
    project: `p-${id}`,
    displayName: id,
    secretHash: "h",
    feishuAppId: null,
    allowedTargetsJson: "[]",
    createdAt: AT,
  });
  if (disabled) {
    await db.run("UPDATE agent SET status = 'disabled' WHERE id = ?", id);
  }
}

function addTask(db: Db, id: string, status: "running" | "done"): void {
  insertTask(db, {
    id,
    title: id,
    assigner: "human",
    assignee: "a-ok",
    project: "p-a-ok",
    parentTaskId: null,
    origin: "a2a",
    deadlineAt: null,
    output: null,
    createdAt: AT,
  });
  const applied = updateTask(db, {
    id,
    fromStage: "intake",
    fromStatus: "pending",
    stage: status === "done" ? "closed" : "intake",
    status,
    reworkCount: 0,
    output: null,
    deadlineAt: null,
    startedAt: AT,
    endedAt: status === "done" ? AT : null,
    updatedAt: AT,
  });
  expect(applied).toBe(true);
}

function addRun(
  db: Db,
  id: string,
  agentId: string,
  machineId: string,
  lastSeenAt: number,
  taskId?: string,
): void {
  insertRun(db, {
    id,
    agentId,
    machine: machineId,
    project: `p-${agentId}`,
    streamId: `s-${id}`,
    startedAt: lastSeenAt,
  });
  await db.run("UPDATE agent_run SET last_seen_at = ? WHERE id = ?", lastSeenAt, id);
  if (taskId !== undefined) {
    expect(bindRunTaskIfEmpty(db, id, taskId)).toBe(true);
  }
}

function addTokens(
  db: Db,
  id: string,
  agentId: string,
  runId: string,
  taskId: string | null,
  occurredAt: number,
  total: number,
): void {
  insertTokenUsage(db, {
    id,
    agentId,
    taskId,
    runId,
    provider: "anthropic",
    model: "claude",
    inputTokens: total,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    source: "transcript",
    sequence: 1,
    receiptHash: `h-${id}`,
    occurredAt,
  });
}

describe("overview 服务", () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(":memory:");
    runMigrations(db);

    addMachine(db, "m-ok", AT - 60_000);
    addMachine(db, "m-timeout", AT - MACHINE_HEARTBEAT.timeoutMs - 1);
    addMachine(db, "m-offline", AT - MACHINE_HEARTBEAT.offlineMs - 1);
    addMachine(db, "m-unknown", null);

    addAgent(db, "a-ok", "m-ok");
    addAgent(db, "a-timeout", "m-timeout");
    addAgent(db, "a-offline", "m-offline");
    addAgent(db, "a-unknown", "m-unknown");
    addAgent(db, "a-disabled", "m-ok", true);

    addTask(db, "t1", "running");
    addTask(db, "t2", "running");
    addTask(db, "t3", "done");

    addRun(db, "r-ok", "a-ok", "m-ok", AT - 60_000, "t1");
    addRun(db, "r-timeout", "a-timeout", "m-timeout", AT - 10 * 60_000, "t2");
    addRun(db, "r-offline", "a-offline", "m-offline", AT - RUN_IDLE_GAP_MS - 1, "t3");
    addRun(db, "r-disabled", "a-disabled", "m-ok", AT - 60_000);

    addTokens(db, "tu-1", "a-ok", "r-ok", "t1", AT - 60 * 60_000, 165);
    addTokens(db, "tu-2", "a-timeout", "r-timeout", "t2", AT - 2 * 60 * 60_000, 7);
    addTokens(
      db,
      "tu-3",
      "a-offline",
      "r-offline",
      "t3",
      startOfLocalDay(AT) - 1,
      999,
    );

    insertCapability(db, {
      id: "c1",
      subject: "a-ok",
      target: "db.prod",
      action: "read",
      scopeJson: "{}",
      ttlSeconds: 900,
      taskId: "t1",
      createdAt: AT,
    });
    insertCapability(db, {
      id: "c2",
      subject: "a-ok",
      target: "db.prod",
      action: "write",
      scopeJson: "{}",
      ttlSeconds: 900,
      taskId: "t2",
      createdAt: AT,
    });
    insertCapability(db, {
      id: "c3",
      subject: "a-ok",
      target: "db.prod",
      action: "read",
      scopeJson: "{}",
      ttlSeconds: 900,
      taskId: "t1",
      createdAt: AT,
    });
    await db.run("UPDATE capability SET status = 'active' WHERE id = 'c3'");
  });

  afterEach(() => {
    db.close();
  });

  it("五项指标与 Agent 列表共用同一时间窗口", () => {
    const service = createOverviewService({ db, now: () => AT });
    const snapshot = service.get();

    expect(snapshot.generatedAt).toBe(AT);
    expect(snapshot.todayStart).toBe(startOfLocalDay(AT));
    expect(snapshot.metrics).toEqual({
      runningAgents: 2,
      runningTasks: 2,
      todayTokens: 172,
      pendingApprovals: 2,
      // m-timeout 与 m-offline 都超过 5 分钟;m-unknown 从未上报,不计入
      heartbeatTimeouts: 2,
    });
    expect(snapshot.revision).toBe(currentRevision(db, OVERVIEW_SCOPE));
    expect(snapshot.revision).toBeGreaterThan(0);
  });

  it("一行一 Agent:运行中置前,停用 Agent 不出现", () => {
    const service = createOverviewService({ db, now: () => AT });
    const agents = service.get().agents;

    expect(agents.map((agent) => agent.id)).toEqual([
      "a-ok",
      "a-timeout",
      "a-offline",
      "a-unknown",
    ]);

    expect(agents[0]).toMatchObject({
      heartbeat: "ok",
      running: true,
      currentTaskId: "t1",
      currentTaskTitle: "t1",
      currentTaskStatus: "running",
      currentInstruction: null,
      todayTokens: 165,
    });
    expect(agents[1]).toMatchObject({
      heartbeat: "timeout",
      running: true,
      currentTaskId: "t2",
      todayTokens: 7,
    });
    expect(agents[2]).toMatchObject({
      heartbeat: "offline",
      running: false,
      currentTaskId: null,
      lastRunAt: AT - RUN_IDLE_GAP_MS - 1,
      todayTokens: 0,
    });
    expect(agents[3]).toMatchObject({
      heartbeat: "unknown",
      machineLastSeenAt: null,
      running: false,
      lastRunAt: null,
      currentInstruction: null,
      todayTokens: 0,
    });
  });

  it("无任务归属时带出当前 run 最近一条用户指令并压平空白", () => {
    addMachine(db, "m-live", AT - 60_000);
    addAgent(db, "a-live", "m-live");
    addRun(db, "r-live", "a-live", "m-live", AT - 60_000);
    const base = {
      runId: "r-live",
      turnId: "turn-live",
      blockId: "blk-live",
      blockRev: 1,
      offset: null,
    };
    insertTimelineEvent(db, {
      ...base,
      id: "tle-old",
      ord: 1,
      kind: "user_message",
      payload: { text: "更早的指令" },
      occurredAt: AT - 50_000,
    });
    insertTimelineEvent(db, {
      ...base,
      id: "tle-new",
      ord: 2,
      kind: "user_message",
      payload: { text: "  先看一下\n\n发件箱的重试策略  " },
      occurredAt: AT - 30_000,
    });
    insertTimelineEvent(db, {
      ...base,
      id: "tle-reply",
      ord: 3,
      kind: "assistant_text",
      payload: { text: "好的" },
      occurredAt: AT - 20_000,
    });
    // 运行时注入的尖括号块也走 user_message,但不算人的指令
    insertTimelineEvent(db, {
      ...base,
      id: "tle-injected",
      ord: 4,
      kind: "user_message",
      payload: { text: "<task-notification>后台任务完成</task-notification>" },
      occurredAt: AT - 10_000,
    });

    const agents = createOverviewService({ db, now: () => AT }).get().agents;
    expect(agents.find((agent) => agent.id === "a-live")).toMatchObject({
      running: true,
      currentTaskId: null,
      currentInstruction: "先看一下 发件箱的重试策略",
    });
  });
});

describe("时间窗口辅助函数", () => {
  it("startOfLocalDay 取本地日零点", () => {
    const at = new Date(AT);
    expect(new Date(startOfLocalDay(AT)).getHours()).toBe(0);
    expect(new Date(startOfLocalDay(AT)).getMinutes()).toBe(0);
    expect(startOfLocalDay(AT)).toBeLessThanOrEqual(AT);
    expect(AT - startOfLocalDay(AT)).toBeLessThan(24 * 60 * 60 * 1000);
    expect(startOfLocalDay(at.getTime())).toBe(startOfLocalDay(AT));
  });

  it("heartbeatState 按两档阈值判定", () => {
    expect(heartbeatState(null, AT)).toBe("unknown");
    expect(heartbeatState(AT - 60_000, AT)).toBe("ok");
    expect(heartbeatState(AT - MACHINE_HEARTBEAT.timeoutMs, AT)).toBe("timeout");
    expect(heartbeatState(AT - MACHINE_HEARTBEAT.offlineMs, AT)).toBe("offline");
  });
});
