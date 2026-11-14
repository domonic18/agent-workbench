import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectSchedules, nextRunAt } from "./schedule.js";

const dirs: string[] = [];

function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aw-sched-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 本地时间构造,断言与时区无关 */
function local(year: number, month: number, day: number, hour: number, minute: number): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

/** 2026-11-14 是周六 */
const SAT_NOON = local(2026, 11, 14, 12, 0);

describe("cron 下次执行推算", () => {
  it("每天固定时刻取当天或次日", () => {
    const next = nextRunAt("0 9,15,19 * * *", SAT_NOON);
    expect(next).not.toBeNull();
    const at = new Date(next as number);
    expect(at.getHours()).toBe(15);
    expect(at.getMinutes()).toBe(0);
  });

  it("每小时固定分", () => {
    const next = nextRunAt("17 * * * *", SAT_NOON);
    const at = new Date(next as number);
    expect(at.getHours()).toBe(12);
    expect(at.getMinutes()).toBe(17);
  });

  it("步长表达式落在步长倍数上", () => {
    const next = nextRunAt("*/15 * * * *", SAT_NOON);
    expect(new Date(next as number).getMinutes() % 15).toBe(0);
  });

  it("周字段 6 是周六(标准 cron,不是 1=周一)", () => {
    const next = nextRunAt("43 9 * * 6", SAT_NOON);
    const at = new Date(next as number);
    expect(at.getDay()).toBe(6);
    expect(at.getDate()).toBe(21);
    expect(at.getHours()).toBe(9);
    expect(at.getMinutes()).toBe(43);
  });

  it("周字段 0 与 7 都是周日", () => {
    const byZero = nextRunAt("0 8 * * 0", SAT_NOON);
    const bySeven = nextRunAt("0 8 * * 7", SAT_NOON);
    expect(byZero).toBe(bySeven);
    expect(new Date(byZero as number).getDay()).toBe(0);
    expect(new Date(byZero as number).getDate()).toBe(15);
  });

  it("工作日区间跳过周末", () => {
    const next = nextRunAt("0 19 * * 1-5", SAT_NOON);
    const at = new Date(next as number);
    expect(at.getDay()).toBeGreaterThanOrEqual(1);
    expect(at.getDay()).toBeLessThanOrEqual(5);
    expect(at.getHours()).toBe(19);
  });

  it("非法表达式返回 null 而不是抛错", () => {
    expect(nextRunAt("不是 cron", SAT_NOON)).toBeNull();
    expect(nextRunAt("0 9 * *", SAT_NOON)).toBeNull();
    expect(nextRunAt("60 * * * *", SAT_NOON)).toBeNull();
    expect(nextRunAt("0 9 * * 8", SAT_NOON)).toBeNull();
  });
});

describe("定时任务快照采集", () => {
  const now = SAT_NOON;

  function writeJobs(dir: string, kind: "crons" | "timers", jobs: unknown[]): void {
    mkdirSync(join(dir, kind), { recursive: true });
    writeFileSync(join(dir, kind, "jobs.json"), JSON.stringify(jobs), "utf8");
  }

  it("周期任务取到频率与下次执行", () => {
    const dir = newDir();
    writeJobs(dir, "crons", [
      {
        id: "723678e7",
        project: "invest",
        cron_expr: "0 19 * * 1-5",
        description: "盘后自选更新",
        enabled: true,
        last_run: "2026-11-13T19:00:28.969292+08:00",
        created_at: "2026-10-30T11:13:30.378433+08:00",
      },
    ]);

    const rows = collectSchedules({ ccConnectDir: dir, now, timezone: "Asia/Shanghai" });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "cron:723678e7",
      project: "invest",
      kind: "cron",
      description: "盘后自选更新",
      cron_expr: "0 19 * * 1-5",
      enabled: true,
      timezone: "Asia/Shanghai",
    });
    expect(rows[0]?.next_run).toBe(nextRunAt("0 19 * * 1-5", now));
    expect(rows[0]?.last_run).toBeTypeOf("number");
  });

  it("敏感字段不出机器:prompt/exec/work_dir/session_key 一律不取", () => {
    const dir = newDir();
    writeJobs(dir, "crons", [
      {
        id: "x",
        project: "invest",
        cron_expr: "0 9 * * *",
        description: "额度卡片",
        prompt: "ssh ubuntu@10.0.0.1 部署 /opt/app 并带 token=secret",
        exec: "/Users/deadwalk/.local/bin/quota-push",
        work_dir: "/tmp",
        session_key: "feishu:oc_123:ou_456",
      },
    ]);

    const serialized = JSON.stringify(
      collectSchedules({ ccConnectDir: dir, now, timezone: "Asia/Shanghai" }),
    );

    expect(serialized).not.toContain("ssh ubuntu");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("quota-push");
    expect(serialized).not.toContain("oc_123");
    expect(serialized).not.toContain("/opt/app");
  });

  it("错误摘要里的飞书会话键被脱敏", () => {
    const dir = newDir();
    writeJobs(dir, "crons", [
      {
        id: "x",
        project: "article",
        cron_expr: "17 * * * *",
        description: "突发雷达",
        last_error: 'session "feishu:oc_abc:ou_def" is busy',
      },
    ]);

    const rows = collectSchedules({ ccConnectDir: dir, now, timezone: "Asia/Shanghai" });

    expect(rows[0]?.last_error).not.toContain("oc_abc");
    expect(rows[0]?.last_error).toContain("is busy");
  });

  it("一次性延时任务只留未触发的", () => {
    const dir = newDir();
    writeJobs(dir, "timers", [
      { id: "pending", project: "invest", scheduled_at: "2026-11-14T12:30:00+08:00", fired: false },
      { id: "done", project: "invest", scheduled_at: "2026-11-13T12:30:00+08:00", fired: true },
    ]);

    const rows = collectSchedules({ ccConnectDir: dir, now, timezone: "Asia/Shanghai" });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "timer:pending", kind: "timer", cron_expr: null });
    expect(rows[0]?.next_run).toBe(Date.parse("2026-11-14T12:30:00+08:00"));
  });

  it("epoch 秒与带小数的时刻都归一成整数毫秒", () => {
    const dir = newDir();
    writeJobs(dir, "crons", [
      {
        id: "sec",
        project: "invest",
        cron_expr: "0 9 * * *",
        description: "秒制",
        last_run: 1794567628.969292,
        created_at: 1793330010,
      },
    ]);

    const rows = collectSchedules({ ccConnectDir: dir, now, timezone: "Asia/Shanghai" });

    expect(rows[0]?.last_run).toBe(1794567628969);
    expect(rows[0]?.created_at).toBe(1793330010000);
  });

  it("负数是「从未执行」的占位值,按没有处理", () => {
    const dir = newDir();
    writeJobs(dir, "crons", [
      {
        id: "never",
        project: "cc-arch",
        cron_expr: "30 9 * * 1",
        description: "还没跑过",
        last_run: -62135596800000,
      },
    ]);

    const rows = collectSchedules({ ccConnectDir: dir, now, timezone: "Asia/Shanghai" });

    expect(rows[0]?.last_run).toBeNull();
  });

  it("文件缺失或损坏返回空,不抛错", () => {
    const dir = newDir();
    expect(collectSchedules({ ccConnectDir: dir, now, timezone: "Asia/Shanghai" })).toEqual([]);
    mkdirSync(join(dir, "crons"), { recursive: true });
    writeFileSync(join(dir, "crons", "jobs.json"), "{ 坏掉的 json", "utf8");
    expect(collectSchedules({ ccConnectDir: dir, now, timezone: "Asia/Shanghai" })).toEqual([]);
  });

  it("缺 id 的计划也不会撞 id(前端按 id 当行键)", () => {
    const dir = newDir();
    writeJobs(dir, "crons", [
      { project: "invest", cron_expr: "0 9 * * *", description: "同一条" },
      { project: "invest", cron_expr: "0 9 * * *", description: "同一条" },
    ]);

    const rows = collectSchedules({ ccConnectDir: dir, now, timezone: "Asia/Shanghai" });

    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).not.toBe(rows[1]?.id);
  });

  it("停用的周期任务没有下次执行时刻", () => {
    const dir = newDir();
    writeJobs(dir, "crons", [
      { id: "off", project: "invest", cron_expr: "0 9 * * *", description: "停用任务", enabled: false },
    ]);

    const rows = collectSchedules({ ccConnectDir: dir, now, timezone: "Asia/Shanghai" });

    expect(rows[0]?.enabled).toBe(false);
    expect(rows[0]?.next_run).toBeNull();
  });
});
