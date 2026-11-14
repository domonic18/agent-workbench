import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueOneTimeToken } from "../../domain/bootstrap/one-time-token.js";
import { ONE_TIME_TOKEN } from "../../shared/constants.js";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "simple-123456";

function cookieOf(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    throw new Error("响应没有 set-cookie");
  }
  return value.split(";")[0] as string;
}

describe("定时任务只读路由", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    db = await openDatabase();
    await ensureConsoleCredential(db, PASSWORD);
    app = buildApp({ logLevel: "silent", db });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    cookie = cookieOf(login);
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  /** enroll 一台机器,拿到机器 id 与采集密钥 */
  async function enroll(): Promise<{ machineId: string; secret: string }> {
    const { token } = await issueOneTimeToken(db, { purpose: "enroll", ttlMs: ONE_TIME_TOKEN.enrollTtlMs });
    const response = await app.inject({
      method: "POST",
      url: "/api/aw-node/enroll",
      payload: { token, hostname: "mac-test", os: "darwin", collector_version: "0.4.0" },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { machine_id: string; collector_secret: string };
    return { machineId: body.machine_id, secret: body.collector_secret };
  }

  it("未登录拒绝", async () => {
    const response = await app.inject({ method: "GET", url: "/api/schedules" });
    expect(response.statusCode).toBe(401);
  });

  it("采集端上报的计划能读出来,敏感字段不落库", async () => {
    const machine = await enroll();
    const report = await app.inject({
      method: "POST",
      url: "/api/aw-node/discovery",
      headers: { authorization: `Bearer ${machine.machineId}.${machine.secret}`, "idempotency-key": "k1" },
      payload: {
        projects: [{ name: "invest" }],
        schedules: [
          {
            id: "cron:1",
            project: "invest",
            kind: "cron",
            description: "盘后自选更新",
            cron_expr: "0 19 * * 1-5",
            scheduled_at: null,
            enabled: true,
            last_run: null,
            next_run: 1_700_003_600_000,
            last_error: null,
            created_at: null,
            timezone: "Asia/Shanghai",
          },
        ],
      },
    });
    expect(report.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: "/api/schedules",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      project: "invest",
      kind: "cron",
      cronExpr: "0 19 * * 1-5",
      description: "盘后自选更新",
      timezone: "Asia/Shanghai",
    });
  });

  it("时刻带小数也不打回整份报告,域层归一成整数毫秒", async () => {
    const machine = await enroll();
    const response = await app.inject({
      method: "POST",
      url: "/api/aw-node/discovery",
      headers: { authorization: `Bearer ${machine.machineId}.${machine.secret}`, "idempotency-key": "k3" },
      payload: {
        projects: [{ name: "invest" }],
        schedules: [
          {
            id: "cron:1",
            project: "invest",
            kind: "cron",
            description: "带小数的时刻",
            cron_expr: "0 9 * * *",
            scheduled_at: null,
            enabled: true,
            last_run: 1794567628.969292,
            next_run: 1794639600000.5,
            last_error: null,
            created_at: null,
            timezone: "Asia/Shanghai",
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);

    const row = await db.get(
      'SELECT schedules::text AS "schedulesText" FROM machine WHERE id = ?',
      machine.machineId,
    );
    // 服务端只负责「必须是整数」:秒/毫秒的单位换算是采集端的活
    const stored = (row as { schedulesText: string }).schedulesText;
    expect(stored).toContain("1794567628");
    expect(stored).toContain("1794639600000");
    expect(stored).not.toContain(".969292");
    expect(stored).not.toContain("0000.5");
  });

  it("采集端多带的敏感字段被协议层剔除", async () => {
    const machine = await enroll();
    const response = await app.inject({
      method: "POST",
      url: "/api/aw-node/discovery",
      headers: { authorization: `Bearer ${machine.machineId}.${machine.secret}`, "idempotency-key": "k2" },
      payload: {
        projects: [],
        schedules: [
          {
            id: "cron:1",
            project: "invest",
            kind: "cron",
            description: "额度卡片",
            cron_expr: "0 9 * * *",
            scheduled_at: null,
            enabled: true,
            last_run: null,
            next_run: null,
            last_error: null,
            created_at: null,
            timezone: "Asia/Shanghai",
            prompt: "ssh ubuntu@10.0.0.1 部署,token=secret",
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);

    const row = await db.get(
      'SELECT schedules::text AS "schedulesText" FROM machine WHERE id = ?',
      machine.machineId,
    );
    expect((row as { schedulesText: string }).schedulesText).not.toContain("secret");
    expect((row as { schedulesText: string }).schedulesText).not.toContain("10.0.0.1");
  });
});
