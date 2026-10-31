import { describe, expect, it } from "vitest";
import type { TaskTraits, TeleportAdapter } from "../../adapters/teleport/tctl.js";
import { openDatabase } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { findCapability } from "../../store/repositories/capability.js";
import { CapabilityError } from "./errors.js";
import { deriveBotName } from "./identity.js";
import { createCapabilityService } from "./service.js";

function prepare() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  db.prepare(
    `INSERT INTO task
       (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
     VALUES ('T-1', '任务', 'a', 'b', 'aw', 'exec', 'running', 'a2a', 0, 0)`,
  ).run();
  return db;
}

function fakeTeleport(fail = false): { calls: TaskTraits[]; adapter: TeleportAdapter } {
  const calls: TaskTraits[] = [];
  return {
    calls,
    adapter: {
      async applyTaskTraits(traits) {
        if (fail) {
          throw new Error("tctl 退出码 1");
        }
        calls.push(traits);
      },
    },
  };
}

const input = {
  subject: "agent:codex",
  target: "db:prod",
  action: "read",
  scope: { schema: "public" },
  ttlSeconds: 900,
  taskId: "T-1",
  actor: "console",
};

function audits(db: ReturnType<typeof prepare>) {
  return db
    .prepare("SELECT action, actor, detail_json AS detail FROM capability_audit ORDER BY id")
    .all() as { action: string; actor: string; detail: string }[];
}

describe("deriveBotName", () => {
  it("把 Agent 身份串收敛为 Teleport bot 名", () => {
    expect(deriveBotName("agent:codex")).toBe("aw-agent-codex");
    expect(deriveBotName("Agent__Codex")).toBe("aw-agent-codex");
  });
});

describe("capability 服务", () => {
  it("申请写入 pending 并审计 requested", () => {
    const db = prepare();
    const service = createCapabilityService({
      db,
      teleport: fakeTeleport().adapter,
      now: () => 1_000,
      newId: () => "cap_1",
    });

    const row = service.request(input);

    expect(row).toMatchObject({
      id: "cap_1",
      status: "pending",
      scopeJson: JSON.stringify({ schema: "public" }),
      createdAt: 1_000,
    });
    expect(audits(db)).toEqual([
      { action: "requested", actor: "console", detail: JSON.stringify({ target: "db:prod", action: "read", ttlSeconds: 900 }) },
    ]);
    db.close();
  });

  it("非法 action / ttl / 缺任务均拒收", () => {
    const db = prepare();
    const service = createCapabilityService({ db, teleport: fakeTeleport().adapter });

    expect(() => service.request({ ...input, action: "delete" })).toThrow(CapabilityError);
    expect(() => service.request({ ...input, ttlSeconds: 0 })).toThrow(CapabilityError);
    expect(() => service.request({ ...input, ttlSeconds: 14_401 })).toThrow(CapabilityError);
    expect(() => service.request({ ...input, taskId: "T-9" })).toThrow(CapabilityError);
    expect(() => service.request({ ...input, subject: "" })).toThrow(CapabilityError);
    db.close();
  });

  it("批准经 issuing 落 active,写入票据与过期时间", async () => {
    const db = prepare();
    const teleport = fakeTeleport();
    let clock = 1_000;
    const service = createCapabilityService({
      db,
      teleport: teleport.adapter,
      now: () => clock,
      newId: () => "cap_1",
      newTicketId: () => "tkt_1",
    });
    service.request(input);

    clock = 2_000;
    const result = await service.approve("cap_1", "console");

    expect(result.applied).toBe(true);
    expect(result.capability).toMatchObject({
      status: "active",
      ticketId: "tkt_1",
      issuedAt: 2_000,
      expiresAt: 2_000 + 900 * 1_000,
    });
    expect(teleport.calls).toEqual([
      { botName: "aw-agent-codex", taskId: "T-1", ticketId: "tkt_1" },
    ]);
    expect(audits(db).map((row) => row.action)).toEqual(["requested", "approved", "issued"]);
    db.close();
  });

  it("签发失败转 rejected 并抛 503,可重新申请", async () => {
    const db = prepare();
    const teleport = fakeTeleport(true);
    let clock = 1_000;
    let seq = 0;
    const service = createCapabilityService({
      db,
      teleport: teleport.adapter,
      now: () => clock,
      newId: () => `cap_${++seq}`,
      newTicketId: () => "tkt_1",
    });
    service.request(input);

    clock = 2_000;
    const error = await service.approve("cap_1", "console").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CapabilityError);
    expect(error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", status: 503 });
    expect(findCapability(db, "cap_1")).toMatchObject({ status: "rejected", ticketId: "tkt_1" });
    expect(audits(db).map((row) => row.action)).toEqual([
      "requested",
      "approved",
      "issue_failed",
    ]);
    expect(teleport.calls).toHaveLength(0);

    const again = service.request({ ...input, actor: "console" });
    expect(again.status).toBe("pending");
    db.close();
  });

  it("重复批准返回首次结果", async () => {
    const db = prepare();
    const service = createCapabilityService({
      db,
      teleport: fakeTeleport().adapter,
      newId: () => "cap_1",
      newTicketId: () => "tkt_1",
    });
    service.request(input);
    await service.approve("cap_1", "console");

    const repeat = await service.approve("cap_1", "console");
    expect(repeat.applied).toBe(false);
    expect(repeat.capability.status).toBe("active");
    db.close();
  });

  it("拒绝只对 pending 生效,并审计原因", () => {
    const db = prepare();
    const service = createCapabilityService({
      db,
      teleport: fakeTeleport().adapter,
      newId: () => "cap_1",
    });
    service.request(input);

    const result = service.reject("cap_1", "console", "范围过大");
    expect(result.applied).toBe(true);
    expect(result.capability.status).toBe("rejected");
    expect(audits(db).at(-1)).toEqual({
      action: "rejected",
      actor: "console",
      detail: JSON.stringify({ reason: "范围过大" }),
    });

    expect(service.reject("cap_1", "console").applied).toBe(false);
    db.close();
  });

  it("吊销只对 active 生效", async () => {
    const db = prepare();
    const service = createCapabilityService({
      db,
      teleport: fakeTeleport().adapter,
      now: () => 1_000,
      newId: () => "cap_1",
      newTicketId: () => "tkt_1",
    });
    service.request(input);

    expect(service.revoke("cap_1", "console").applied).toBe(false);
    await service.approve("cap_1", "console");

    const result = service.revoke("cap_1", "console");
    expect(result.applied).toBe(true);
    expect(result.capability).toMatchObject({ status: "revoked", revokedAt: 1_000 });
    expect(audits(db).at(-1)?.action).toBe("revoked");
    db.close();
  });

  it("待批超 24h 由对账收敛为 rejected", () => {
    const db = prepare();
    let clock = 1_000;
    const service = createCapabilityService({
      db,
      teleport: fakeTeleport().adapter,
      now: () => clock,
      newId: () => "cap_1",
    });
    service.request(input);

    clock = 1_000 + 24 * 60 * 60 * 1_000 - 1;
    expect(service.expireStalePending()).toBe(0);

    clock += 2;
    expect(service.expireStalePending()).toBe(1);
    expect(findCapability(db, "cap_1")).toMatchObject({ status: "rejected" });
    expect(audits(db).at(-1)).toEqual({
      action: "rejected",
      actor: "system",
      detail: JSON.stringify({ reason: "pending_timeout" }),
    });
    db.close();
  });

  it("issuing 超 60s 由对账收敛为 rejected", async () => {
    const db = prepare();
    let clock = 1_000;
    let release: (() => void) | undefined;
    const pendingTeleport: TeleportAdapter = {
      applyTaskTraits: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    };
    const service = createCapabilityService({
      db,
      teleport: pendingTeleport,
      now: () => clock,
      newId: () => "cap_1",
      newTicketId: () => "tkt_1",
    });
    service.request(input);
    const approving = service.approve("cap_1", "console");
    expect(findCapability(db, "cap_1")?.status).toBe("issuing");

    clock = 1_000 + 60_001;
    expect(service.reconcileStaleIssuing()).toBe(1);
    expect(findCapability(db, "cap_1")?.status).toBe("rejected");
    expect(audits(db).at(-1)).toMatchObject({ action: "reconciled", actor: "system" });

    release?.();
    const late = await approving;
    // 补偿已把行推到 rejected,迟到的签发成功不能再把它改成 active
    expect(late.applied).toBe(false);
    expect(findCapability(db, "cap_1")?.status).toBe("rejected");
    db.close();
  });
});
