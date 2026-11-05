import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertAgent, type NewAgent } from "../../store/repositories/identity.js";
import { claimPendingForAgent } from "../../store/repositories/work-inbox.js";
import { findWorkItemById, listWorkItemEvents } from "../../store/repositories/work-item.js";
import type { WorkPolicy } from "../routing/policy.js";
import type { WorkRequest } from "./contract.js";
import { createIngestService } from "./ingest-service.js";

const AGENT_KEY = "wb-primary";
const ISSUE_KEY = "https://github.com/octocat/demo/issues/12";

function workAgent(): NewAgent {
  return {
    id: "agt_w",
    machineId: null,
    runtime: "workbuddy",
    project: "demo",
    displayName: "Worker",
    secretHash: null,
    feishuAppId: null,
    allowedTargetsJson: "[]",
    key: AGENT_KEY,
    createdAt: 1_000,
  };
}

function testPolicy(): WorkPolicy {
  return {
    version: "test-version",
    workKinds: {
      bug_fix: {
        mandate: { expectedResult: "修好", scope: "只修缺陷,不顺手重构" },
        evidence: ["PR 链接"],
      },
    },
    rules: [
      { ruleId: "default-bug-fix", source: "bug", kind: "submitted", workKind: "bug_fix", targetRole: "primary" },
    ],
    registry: { demo: { primary: AGENT_KEY } },
  };
}

function request(overrides: Partial<WorkRequest> = {}): WorkRequest {
  return {
    source: "bug",
    sourceEventId: "evt-1",
    kind: "submitted",
    occurredAt: 1_000,
    actor: { agent_id: "agt_bug" },
    project: "demo",
    threadRefs: [{ source: "bug", externalKind: "issue", externalKey: ISSUE_KEY }],
    payload: { title: "登录页 500" },
    refs: [],
    ...overrides,
  };
}

interface Fixture {
  db: Db;
  ingest: ReturnType<typeof createIngestService>["ingest"];
}

async function prepare(claim: boolean): Promise<Fixture> {
  const db = await openDatabase();
  await insertAgent(db, workAgent());
  const counters = new Map<string, number>();
  const next = (prefix: string) => () => {
    const seq = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, seq);
    return `${prefix}_${seq}`;
  };
  const service = createIngestService({
    db,
    now: () => 5_000,
    policy: testPolicy(),
    newTriggerId: next("wtg"),
    newItemId: next("wim"),
    newEventId: next("wev"),
    newInboxId: next("wib"),
    newThreadId: next("wth"),
    newSubscriptionId: next("wsb"),
  });
  const submitted = await service.ingest(request());
  expect(submitted.trigger.disposition).toBe("routed");
  const workItemId = submitted.workItem?.id;
  if (workItemId === undefined) {
    throw new Error("建单失败");
  }
  if (claim) {
    // 承接者须已领取 assignment(claimed/acked)才算活跃,才会被返工唤醒
    await claimPendingForAgent(db, "agt_w", 5_000, 15_000);
  }
  return { db, ingest: service.ingest };
}

function decide(fixture: Fixture, kind: "accepted" | "returned", seq = 1) {
  return fixture.ingest(
    request({
      sourceEventId: `decide-${seq}-${kind}`,
      kind,
      payload: { action: kind, reason: "复现路径不对" },
    }),
  );
}

describe("bug 裁决分支(bug.accepted / bug.returned)", () => {
  it("accepted:收口 done + acceptance_ref + 停表,零投递", async () => {
    const fixture = await prepare(true);
    const db = fixture.db;
    const result = await decide(fixture, "accepted");
    expect(result.trigger.disposition).toBe("continued");
    expect(result.trigger.targetAgentId).toBeNull();

    const item = await findWorkItemById(db, "wim_1");
    expect(item).toMatchObject({
      status: "done",
      attention: "none",
      nextAction: null,
      acceptanceRef: "wtg_2",
      endedAt: 5_000,
    });
    const events = (await listWorkItemEvents(db, "wim_1")).map((event) => event.kind);
    expect(events).toEqual(["routed", "assigned", "accepted"]);
    expect(await db.get("SELECT COUNT(*) AS n FROM worker_inbox")).toEqual({ n: 1 });
    await db.close();
  });

  it("returned:同一事项回 execute,活跃承接者收到返工 input", async () => {
    const fixture = await prepare(true);
    const db = fixture.db;
    const result = await decide(fixture, "returned");
    expect(result.trigger.disposition).toBe("continued");
    expect(result.trigger.targetAgentId).toBe("agt_w");

    const item = await findWorkItemById(db, "wim_1");
    expect(item).toMatchObject({
      status: "open",
      stage: "execute",
      attention: "blocked",
    });
    expect(item?.nextAction).toContain("退回返工");
    const events = (await listWorkItemEvents(db, "wim_1")).map((event) => event.kind);
    expect(events).toEqual(["routed", "assigned", "returned", "input"]);
    const rows = await db.all(
      "SELECT kind, target_agent_id AS t FROM worker_inbox ORDER BY created_at, id",
    );
    expect(rows).toEqual([
      { kind: "assignment", t: "agt_w" },
      { kind: "input", t: "agt_w" },
    ]);
    await db.close();
  });

  it("returned 无活跃承接者:确定性交人 owner_unassigned,不投递", async () => {
    const fixture = await prepare(false);
    const db = fixture.db;
    const result = await decide(fixture, "returned");
    expect(result.trigger.disposition).toBe("needs_person");
    expect(result.trigger.reasonCode).toBe("owner_unassigned");
    expect(result.trigger.workItemId).toBe("wim_1");

    const item = await findWorkItemById(db, "wim_1");
    expect(item).toMatchObject({ stage: "execute", attention: "blocked" });
    const events = (await listWorkItemEvents(db, "wim_1")).map((event) => event.kind);
    expect(events).toEqual(["routed", "assigned", "returned"]);
    expect(await db.get("SELECT COUNT(*) AS n FROM worker_inbox")).toEqual({ n: 1 });
    await db.close();
  });

  it("已收口后的再次裁决不再进裁决分支:owner 事项已 closed,路由交人留痕", async () => {
    const fixture = await prepare(true);
    const db = fixture.db;
    await decide(fixture, "accepted", 1);
    const again = await decide(fixture, "accepted", 2);
    expect(again.trigger.disposition).toBe("needs_person");
    expect(again.trigger.reasonCode).toBe("owner_closed");

    const item = await findWorkItemById(db, "wim_1");
    expect(item?.status).toBe("done");
    expect(item?.endedAt).toBe(5_000);
    await db.close();
  });
});
