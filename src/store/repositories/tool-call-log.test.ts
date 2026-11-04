import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import { insertToolCallLog } from "./tool-call-log.js";

async function prepare(): Promise<Db> {
  const db = await openDatabase();
  await db.run(
    `INSERT INTO task (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
     VALUES ('T-1', '测试任务', 'human', 'agt_1', 'proj', 'exec', 'running', 'a2a', 1000, 1000)`,
  );
  return db;
}

describe("tool_call_log 仓储", () => {
  it("写入判定记录", async () => {
    const db = await prepare();
    await insertToolCallLog(db, {
      runId: "run_1",
      agentId: "agt_1",
      taskId: "T-1",
      tool: "task.create",
      argsHash: "abc",
      level: "L1",
      verdict: "allow",
      reason: null,
      capabilityId: null,
      durationMs: null,
      occurredAt: 2000,
    });

    expect(
      await db.get(
        `SELECT run_id AS "runId", tool, level, verdict, reason, occurred_at AS "occurredAt"
           FROM tool_call_log`,
      ),
    ).toEqual({
      runId: "run_1",
      tool: "task.create",
      level: "L1",
      verdict: "allow",
      reason: null,
      occurredAt: 2000,
    });
    await db.close();
  });

  it("append-only:更新与删除都被拒绝", async () => {
    const db = await prepare();
    await insertToolCallLog(db, {
      runId: "run_1",
      agentId: "agt_1",
      taskId: "T-1",
      tool: "fs.write",
      argsHash: "abc",
      level: "L2",
      verdict: "require_approval",
      reason: "L2",
      capabilityId: null,
      durationMs: null,
      occurredAt: 2000,
    });

    await expect(db.run("UPDATE tool_call_log SET reason = 'x'")).rejects.toThrow(
      /append-only/,
    );
    await expect(db.run("DELETE FROM tool_call_log")).rejects.toThrow(/append-only/);
    await db.close();
  });

  it("任务不存在时写入失败,由闸门转为拒绝", async () => {
    const db = await prepare();
    await expect(
      insertToolCallLog(db, {
        runId: "run_1",
        agentId: "agt_1",
        taskId: "T-missing",
        tool: "fs.read",
        argsHash: "abc",
        level: "L0",
        verdict: "allow",
        reason: null,
        capabilityId: null,
        durationMs: null,
        occurredAt: 2000,
      }),
    ).rejects.toThrow(/foreign key/i);
    await db.close();
  });
});
