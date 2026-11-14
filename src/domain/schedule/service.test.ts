import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MACHINE_HEARTBEAT } from "../../shared/constants.js";
import type { ScheduleReport } from "../../shared/aw-node-wire.js";
import { openDatabase, type Db } from "../../store/database.js";
import { insertAgent } from "../../store/repositories/agent.js";
import { insertMachine, saveMachineSchedules } from "../../store/repositories/machine.js";
import { listScheduleRows } from "./service.js";

const AT = 1_700_000_000_000;

function cronReport(overrides: Partial<ScheduleReport> = {}): ScheduleReport {
  return {
    id: "cron:1",
    project: "invest",
    kind: "cron",
    description: "盘后自选更新",
    cron_expr: "0 19 * * 1-5",
    scheduled_at: null,
    enabled: true,
    last_run: AT - 86_400_000,
    next_run: AT + 3_600_000,
    last_error: null,
    created_at: AT - 86_400_000,
    timezone: "Asia/Shanghai",
    ...overrides,
  };
}

describe("定时任务只读观测", () => {
  let db: Db;

  beforeEach(async () => {
    db = await openDatabase();
    await insertMachine(db, {
      id: "m-ok",
      hostname: "macmini",
      os: "darwin",
      collectorVersion: "1.0.0",
      collectorSecretHash: "h",
      createdAt: AT,
    });
    await db.run("UPDATE machine SET last_seen_at = ? WHERE id = ?", AT - 60_000, "m-ok");
    await insertMachine(db, {
      id: "m-off",
      hostname: "off-box",
      os: "darwin",
      collectorVersion: "1.0.0",
      collectorSecretHash: "h",
      createdAt: AT,
    });
    await db.run(
      "UPDATE machine SET last_seen_at = ? WHERE id = ?",
      AT - MACHINE_HEARTBEAT.offlineMs - 1,
      "m-off",
    );
    await insertAgent(db, {
      id: "a-invest",
      machineId: "m-ok",
      runtime: "claude_code",
      project: "invest",
      displayName: "投资助手",
      secretHash: "h",
      feishuAppId: null,
      allowedTargetsJson: "[]",
      createdAt: AT,
    });
    await db.run(
      "UPDATE agent SET feishu_bot_name = ? WHERE id = ?",
      "投资机器人",
      "a-invest",
    );
  });

  afterEach(async () => {
    await db.close();
  });

  it("按机器与项目对上 Agent 机器人", async () => {
    await saveMachineSchedules(db, "m-ok", [cronReport()]);

    const rows = await listScheduleRows(db, AT);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      project: "invest",
      kind: "cron",
      cronExpr: "0 19 * * 1-5",
      agentId: "a-invest",
      agentName: "投资助手",
      botName: "投资机器人",
      machineName: "macmini",
      stale: false,
    });
  });

  it("同一项目名在不同机器上的 Agent 各归各的", async () => {
    await insertMachine(db, {
      id: "m-two",
      hostname: "other-box",
      os: "darwin",
      collectorVersion: "1.0.0",
      collectorSecretHash: "h",
      createdAt: AT,
    });
    await db.run("UPDATE machine SET last_seen_at = ? WHERE id = ?", AT - 60_000, "m-two");
    await insertAgent(db, {
      id: "a-other",
      machineId: "m-two",
      runtime: "claude_code",
      project: "invest",
      displayName: "另一个投资助手",
      secretHash: "h",
      feishuAppId: null,
      allowedTargetsJson: "[]",
      createdAt: AT,
    });
    await saveMachineSchedules(db, "m-ok", [cronReport()]);
    await saveMachineSchedules(db, "m-two", [cronReport({ id: "cron:2" })]);

    const rows = await listScheduleRows(db, AT);

    expect(rows).toHaveLength(2);
    const byMachine = new Map(rows.map((row) => [row.machineId, row]));
    expect(byMachine.get("m-ok")?.agentId).toBe("a-invest");
    expect(byMachine.get("m-two")?.agentId).toBe("a-other");
  });

  it("项目未登记时如实留空,不硬编机器人", async () => {
    await saveMachineSchedules(db, "m-ok", [cronReport({ project: "article" })]);

    const rows = await listScheduleRows(db, AT);

    expect(rows[0]?.agentId).toBeNull();
    expect(rows[0]?.agentName).toBeNull();
    expect(rows[0]?.project).toBe("article");
  });

  it("机器离线时标状态未知,条目不消失", async () => {
    await saveMachineSchedules(db, "m-off", [cronReport({ id: "cron:off" })]);

    const rows = await listScheduleRows(db, AT);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.stale).toBe(true);
  });

  it("一次性延时任务按 kind 区分,执行时刻落在 scheduled_at", async () => {
    await saveMachineSchedules(db, "m-ok", [
      cronReport({
        id: "timer:1",
        kind: "timer",
        cron_expr: null,
        scheduled_at: AT + 600_000,
        next_run: AT + 600_000,
        last_run: null,
      }),
    ]);

    const rows = await listScheduleRows(db, AT);

    expect(rows[0]).toMatchObject({
      kind: "timer",
      cronExpr: null,
      scheduledAt: AT + 600_000,
      nextRunAt: AT + 600_000,
    });
  });

  it("库里存着负数的「从未执行」占位值时,读出来按没有", async () => {
    await saveMachineSchedules(db, "m-ok", [
      cronReport({
        id: "cron:never",
        last_run: -62135596800000,
        next_run: 1_700_003_600_000,
      }),
    ]);

    const rows = await listScheduleRows(db, AT);

    expect(rows[0]?.lastRunAt).toBeNull();
    expect(rows[0]?.nextRunAt).toBe(1_700_003_600_000);
  });

  it("没有上报计划的机器不产生条目", async () => {
    expect(await listScheduleRows(db, AT)).toEqual([]);
  });
});
