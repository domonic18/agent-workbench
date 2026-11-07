import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import {
  appendCapabilityAudit,
  findCapability,
  findStaleIssuing,
  findStalePending,
  insertCapability,
  listCapabilities,
  transitionCapability,
} from "./capability.js";

async function prepare(): Promise<Db> {
  const db = await openDatabase();
  await db.run(
    `INSERT INTO task
       (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
     VALUES ('T-1', '任务', 'a', 'b', 'aw', 'exec', 'running', 'a2a', 0, 0)`,
  );
  return db;
}

async function seed(
  db: Db,
  id: string,
  createdAt: number,
  status: "pending" | "issuing" = "pending",
): Promise<void> {
  await insertCapability(db, {
    id,
    subject: "agent:codex",
    target: "db:prod",
    action: "read",
    scopeJson: "{}",
    ttlSeconds: 900,
    taskId: "T-1",
    createdAt,
  });
  if (status === "issuing") {
    expect(
      await transitionCapability(db, { id, from: "pending", to: "issuing", now: createdAt }),
    ).toBe(true);
  }
}

describe("capability 仓储", () => {
  it("写入后按驼峰字段读回,初始为 pending", async () => {
    const db = await prepare();
    await seed(db, "cap_1", 1_000);

    expect(await findCapability(db, "cap_1")).toMatchObject({
      id: "cap_1",
      subject: "agent:codex",
      target: "db:prod",
      action: "read",
      scopeJson: "{}",
      ttlSeconds: 900,
      status: "pending",
      ticketId: null,
      taskId: "T-1",
      issuedAt: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(await findCapability(db, "nope")).toBeUndefined();
    await db.close();
  });

  it("条件迁移只在状态仍是 from 时生效", async () => {
    const db = await prepare();
    await seed(db, "cap_1", 1_000);

    expect(
      await transitionCapability(db, { id: "cap_1", from: "pending", to: "issuing", now: 2_000 }),
    ).toBe(true);
    expect(
      await transitionCapability(db, { id: "cap_1", from: "pending", to: "rejected", now: 3_000 }),
    ).toBe(false);

    expect(
      await transitionCapability(db, {
        id: "cap_1",
        from: "issuing",
        to: "active",
        now: 4_000,
        ticketId: "tkt_1",
        issuedAt: 4_000,
        expiresAt: 904_000,
      }),
    ).toBe(true);
    expect(await findCapability(db, "cap_1")).toMatchObject({
      status: "active",
      ticketId: "tkt_1",
      issuedAt: 4_000,
      expiresAt: 904_000,
      updatedAt: 4_000,
    });
    await db.close();
  });

  it("审计表 append-only,改写与删除都被触发器中止", async () => {
    const db = await prepare();
    await seed(db, "cap_1", 1_000);
    await appendCapabilityAudit(db, {
      capabilityId: "cap_1",
      action: "requested",
      actor: "console",
      detail: { target: "db:prod" },
      occurredAt: 1_000,
    });

    expect(await db.all("SELECT action, actor FROM capability_audit")).toEqual([
      { action: "requested", actor: "console" },
    ]);
    await expect(db.run("UPDATE capability_audit SET actor = 'x'")).rejects.toThrow(
      /append-only/,
    );
    await expect(db.run("DELETE FROM capability_audit")).rejects.toThrow(/append-only/);
    await db.close();
  });

  it("按键集分页并以创建时间倒序", async () => {
    const db = await prepare();
    await seed(db, "cap_a", 1_000);
    await seed(db, "cap_c", 2_000);
    await seed(db, "cap_b", 2_000);

    const first = await listCapabilities(db, { limit: 2 });
    expect(first.map((row) => row.id)).toEqual(["cap_c", "cap_b"]);

    const next = await listCapabilities(db, {
      limit: 2,
      before: { createdAt: 2_000, id: "cap_b" },
    });
    expect(next.map((row) => row.id)).toEqual(["cap_a"]);

    const last = first.at(-1);
    expect(last).toBeDefined();
    expect(
      await listCapabilities(db, { limit: 10, before: { createdAt: last!.createdAt, id: last!.id } }),
    ).toHaveLength(1);
    await db.close();
  });

  it("按状态过滤", async () => {
    const db = await prepare();
    await seed(db, "cap_1", 1_000);
    await seed(db, "cap_2", 2_000, "issuing");

    expect(
      (await listCapabilities(db, { limit: 10, status: "issuing" })).map((row) => row.id),
    ).toEqual(["cap_2"]);
    await db.close();
  });

  it("待批超时与 issuing 滞留按截止时间筛选", async () => {
    const db = await prepare();
    await seed(db, "cap_old", 1_000);
    await seed(db, "cap_new", 5_000);
    await seed(db, "cap_issuing", 1_000, "issuing");

    expect((await findStalePending(db, 4_000)).map((row) => row.id)).toEqual(["cap_old"]);
    expect(await findStalePending(db, 4_000, 1)).toHaveLength(1);
    expect((await findStaleIssuing(db, 4_000)).map((row) => row.id)).toEqual(["cap_issuing"]);
    await db.close();
  });
});
