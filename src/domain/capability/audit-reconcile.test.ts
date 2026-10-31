import { describe, expect, it } from "vitest";
import type { SessionStartEvent, TeleportAuditAdapter } from "../../adapters/teleport/audit.js";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { listGaps } from "../../store/repositories/audit-reconcile.js";
import { insertToolCallLog } from "../../store/repositories/tool-call-log.js";
import { createAuditReconciler } from "./audit-reconcile.js";

const NOW = 1_000_000;

function prepare(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  db.prepare(
    `INSERT INTO task
       (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
     VALUES ('T-1', '任务', 'a', 'b', 'aw', 'exec', 'running', 'a2a', 0, 0)`,
  ).run();
  return db;
}

function seedCapability(db: Db, id: string, ticketId: string, taskId = "T-1"): void {
  db.prepare(
    `INSERT INTO capability
       (id, subject, target, action, scope_json, ttl_seconds, status, ticket_id, task_id,
        issued_at, expires_at, created_at, updated_at)
     VALUES (?, 'agent:x', 'db:prod', 'read', '{}', 900, 'active', ?, ?, 0, 0, 0, 0)`,
  ).run(id, ticketId, taskId);
}

function seedCall(db: Db, capabilityId: string, taskId = "T-1"): void {
  insertToolCallLog(db, {
    runId: "run_1",
    agentId: "agt_1",
    taskId,
    tool: "fs.exec",
    argsHash: "a".repeat(64),
    level: "L2",
    verdict: "allow",
    reason: "命中已生效授权",
    capabilityId,
    durationMs: null,
    occurredAt: NOW,
  });
}

function adapter(events: SessionStartEvent[]): TeleportAuditAdapter {
  return { listSessionStarts: async () => events };
}

function session(ticketId: string, taskId: string, sid: string): SessionStartEvent {
  return {
    sid,
    user: "bot-aw-agent",
    login: "agentwork",
    serverHostname: "node-1",
    taskId,
    ticketId,
    time: NOW,
  };
}

describe("审计对账", () => {
  it("会话与票据、任务都对得上时不记缺口", async () => {
    const db = prepare();
    seedCapability(db, "cap_1", "tkt_1");
    seedCall(db, "cap_1");
    const reconciler = createAuditReconciler({
      db,
      teleportAudit: adapter([session("tkt_1", "T-1", "sid_1")]),
      now: () => NOW,
    });

    const result = await reconciler.reconcile();
    expect(result).toEqual({ scanned: 1, sessions: 1, inserted: 0 });
    expect(listGaps(db, { limit: 10 })).toHaveLength(0);
    db.close();
  });

  it("Teleport 无对应会话时记 missing_session", async () => {
    const db = prepare();
    seedCapability(db, "cap_1", "tkt_1");
    seedCall(db, "cap_1");
    const reconciler = createAuditReconciler({ db, teleportAudit: adapter([]), now: () => NOW });

    expect((await reconciler.reconcile()).inserted).toBe(1);
    const [gap] = listGaps(db, { limit: 10 });
    expect(gap).toMatchObject({ kind: "missing_session", ticketId: "tkt_1", taskId: "T-1" });
    db.close();
  });

  it("会话 ticket 对上但 task 对不上时记 ticket_mismatch", async () => {
    const db = prepare();
    seedCapability(db, "cap_1", "tkt_1");
    seedCall(db, "cap_1");
    const reconciler = createAuditReconciler({
      db,
      teleportAudit: adapter([session("tkt_1", "T-OTHER", "sid_1")]),
      now: () => NOW,
    });

    expect((await reconciler.reconcile()).inserted).toBe(1);
    const [gap] = listGaps(db, { limit: 10 });
    expect(gap).toMatchObject({ kind: "ticket_mismatch", ticketId: "tkt_1", sid: "sid_1" });
    db.close();
  });

  it("Teleport 有会话但库里查不到票据时记 orphan_session", async () => {
    const db = prepare();
    const reconciler = createAuditReconciler({
      db,
      teleportAudit: adapter([session("tkt_orphan", "T-9", "sid_9")]),
      now: () => NOW,
    });

    expect((await reconciler.reconcile()).inserted).toBe(1);
    const [gap] = listGaps(db, { limit: 10 });
    expect(gap).toMatchObject({ kind: "orphan_session", ticketId: "tkt_orphan", sid: "sid_9" });
    db.close();
  });

  it("重跑同一批数据不重复记缺口", async () => {
    const db = prepare();
    seedCapability(db, "cap_1", "tkt_1");
    seedCall(db, "cap_1");
    const reconciler = createAuditReconciler({ db, teleportAudit: adapter([]), now: () => NOW });

    expect((await reconciler.reconcile()).inserted).toBe(1);
    expect((await reconciler.reconcile()).inserted).toBe(0);
    expect(listGaps(db, { limit: 10 })).toHaveLength(1);
    db.close();
  });
});
