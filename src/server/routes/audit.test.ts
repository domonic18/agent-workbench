import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TeleportAdapter } from "../../adapters/teleport/tctl.js";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { insertGap, type NewAuditGap } from "../../store/repositories/audit-reconcile.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret123";
const teleport: TeleportAdapter = { async applyTaskTraits() {} };

function prepare(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  ensureConsoleCredential(db, PASSWORD);
  return db;
}

function gap(overrides: Partial<NewAuditGap> = {}): NewAuditGap {
  return {
    dedupKey: "missing_session:1",
    kind: "missing_session",
    toolCallLogId: null,
    capabilityId: null,
    taskId: "T-1",
    ticketId: "tkt_1",
    sid: null,
    detail: { reason: "test" },
    detectedAt: 1000,
    ...overrides,
  };
}

function cookieOf(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    throw new Error("响应没有 set-cookie");
  }
  return value.split(";")[0] as string;
}

describe("audit 路由", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    db = prepare();
    app = buildApp({ logLevel: "silent", db, teleport });
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
    db.close();
  });

  it("未登录返回 401", async () => {
    const response = await app.inject({ method: "GET", url: "/api/audit/gaps" });
    expect(response.statusCode).toBe(401);
  });

  it("列出缺口并可按 kind 过滤", async () => {
    insertGap(db, gap({ dedupKey: "missing_session:1", kind: "missing_session", detectedAt: 1000 }));
    insertGap(
      db,
      gap({ dedupKey: "orphan_session:s9", kind: "orphan_session", ticketId: "tkt_9", detectedAt: 2000 }),
    );

    const all = await app.inject({
      method: "GET",
      url: "/api/audit/gaps",
      headers: { cookie },
    });
    expect(all.statusCode).toBe(200);
    const allBody = all.json() as { items: { kind: string }[]; nextCursor: string | null };
    expect(allBody.items.map((item) => item.kind)).toEqual(["orphan_session", "missing_session"]);

    const filtered = await app.inject({
      method: "GET",
      url: "/api/audit/gaps?kind=orphan_session",
      headers: { cookie },
    });
    const filteredBody = filtered.json() as { items: { kind: string }[] };
    expect(filteredBody.items).toHaveLength(1);
    expect(filteredBody.items[0]?.kind).toBe("orphan_session");
  });

  it("非法 kind 返回 422", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/audit/gaps?kind=bogus",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(422);
  });

  it("keyset 分页逐页取完", async () => {
    insertGap(db, gap({ dedupKey: "g1", detectedAt: 1000 }));
    insertGap(db, gap({ dedupKey: "g2", detectedAt: 2000 }));
    insertGap(db, gap({ dedupKey: "g3", detectedAt: 3000 }));

    const first = await app.inject({
      method: "GET",
      url: "/api/audit/gaps?limit=2",
      headers: { cookie },
    });
    const firstBody = first.json() as {
      items: { detectedAt: number }[];
      nextCursor: string | null;
    };
    expect(firstBody.items.map((item) => item.detectedAt)).toEqual([3000, 2000]);
    expect(firstBody.nextCursor).not.toBeNull();

    const second = await app.inject({
      method: "GET",
      url: `/api/audit/gaps?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
      headers: { cookie },
    });
    const secondBody = second.json() as {
      items: { detectedAt: number }[];
      nextCursor: string | null;
    };
    expect(secondBody.items.map((item) => item.detectedAt)).toEqual([1000]);
    expect(secondBody.nextCursor).toBeNull();
  });
});
