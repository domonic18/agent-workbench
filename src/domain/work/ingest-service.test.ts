import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertAgent, type NewAgent } from "../../store/repositories/identity.js";
import {
  claimPendingForAgent,
  listInboxForWorkItem,
} from "../../store/repositories/work-inbox.js";
import { findWorkItemById, listWorkItemEvents } from "../../store/repositories/work-item.js";
import {
  findActiveOwnerSubscription,
  findWorkThreadByKey,
} from "../../store/repositories/work-thread.js";
import type { WorkPolicy } from "../routing/policy.js";
import { WorkIngestError, type WorkRequest } from "./contract.js";
import { createIngestService } from "./ingest-service.js";

const AGENT_KEY = "wb-primary";

function workAgent(overrides: Partial<NewAgent> = {}): NewAgent {
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
    ...overrides,
  };
}

function testPolicy(agentKey = AGENT_KEY): WorkPolicy {
  return {
    version: "test-version",
    workKinds: {
      bug_fix: {
        mandate: { expectedResult: "修好", scope: "只修缺陷,不顺手重构" },
        evidence: ["PR 链接"],
      },
    },
    rules: [
      {
        ruleId: "default-bug-fix",
        source: "bug",
        kind: "submitted",
        workKind: "bug_fix",
        targetRole: "primary",
      },
    ],
    registry: { demo: { primary: agentKey } },
  };
}

function request(overrides: Partial<WorkRequest> = {}): WorkRequest {
  return {
    source: "bug",
    sourceEventId: "evt-1",
    kind: "submitted",
    occurredAt: 1_000,
    actor: { id: "user-1" },
    project: "demo",
    threadRefs: [{ source: "bug", externalKind: "issue", externalKey: "1" }],
    payload: { title: "登录页 500" },
    refs: [],
    ...overrides,
  };
}

interface Fixture {
  db: Db;
  service: ReturnType<typeof createIngestService>;
}

async function prepare(
  options: { registryKey?: string; registerAgent?: boolean } = {},
): Promise<Fixture> {
  const registryKey = options.registryKey ?? AGENT_KEY;
  const db = await openDatabase();
  if (options.registerAgent !== false) {
    await insertAgent(db, workAgent());
  }
  const counters = new Map<string, number>();
  const next = (prefix: string) => () => {
    const seq = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, seq);
    return `${prefix}_${seq}`;
  };
  const service = createIngestService({
    db,
    now: () => 5_000,
    policy: testPolicy(registryKey),
    newTriggerId: next("wtg"),
    newItemId: next("wim"),
    newEventId: next("wev"),
    newInboxId: next("wib"),
    newThreadId: next("wth"),
    newSubscriptionId: next("wsb"),
  });
  return { db, service };
}

describe("ingest 校验", () => {
  it("契约字段不合法直接拒绝", async () => {
    const { db, service } = await prepare();
    await expect(service.ingest(request({ source: " " }))).rejects.toThrow(WorkIngestError);
    await expect(service.ingest(request({ occurredAt: 1.5 }))).rejects.toThrow(
      WorkIngestError,
    );
    await expect(
      service.ingest(request({ threadRefs: "x" as unknown as WorkRequest["threadRefs"] })),
    ).rejects.toThrow(WorkIngestError);
    expect(await db.get("SELECT COUNT(*) AS n FROM work_trigger")).toEqual({ n: 0 });
    await db.close();
  });
});

describe("ingest 派新工(routed)", () => {
  it("唯一规则命中建事项+订阅+assignment+事件,一个事务落账", async () => {
    const { db, service } = await prepare();
    const result = await service.ingest(request());

    expect(result.replayed).toBe(false);
    expect(result.trigger).toMatchObject({
      disposition: "routed",
      reasonCode: null,
      ruleId: "default-bug-fix",
      ruleVersion: "test-version",
      targetAgentId: "agt_w",
    });
    expect(result.trigger.id).toBe("wtg_1");
    expect(result.workItem).toMatchObject({
      id: "wim_1",
      project: "demo",
      kind: "bug_fix",
      title: "登录页 500",
      expectedResult: "修好",
      status: "open",
      stage: "intake",
      policyVersion: "test-version",
      originTriggerId: "wtg_1",
    });

    const thread = await findWorkThreadByKey(db, "bug", "issue", "1");
    expect(thread).toMatchObject({ project: "demo", status: "active", lastTriggerAt: 5_000 });
    const ownerSub = thread ? await findActiveOwnerSubscription(db, thread.id) : undefined;
    expect(ownerSub).toMatchObject({ workItemId: "wim_1", mode: "owner", createdBy: "router" });

    const inbox = await listInboxForWorkItem(db, "wim_1");
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      kind: "assignment",
      targetAgentId: "agt_w",
      status: "pending",
      idempotencyKey: "assign:wtg_1",
    });
    expect(result.inboxIds).toEqual([inbox[0]?.id]);

    const events = await listWorkItemEvents(db, "wim_1");
    expect(events.map((event) => event.kind)).toEqual(["routed", "assigned"]);
    expect(events[0]?.seq).toBe(1);
    expect(events[1]?.seq).toBe(2);
    await db.close();
  });

  it("payload 无 title 时用来源拼装回退标题", async () => {
    const { db, service } = await prepare();
    const result = await service.ingest(request({ payload: {} }));
    expect(result.workItem?.title).toBe("bug_fix · bug/submitted · evt-1");
    await db.close();
  });

  it("无项目触发不建 Thread,规则命中也确定性 needs_person", async () => {
    const { db, service } = await prepare();
    const result = await service.ingest(request({ project: undefined }));

    expect(result.trigger).toMatchObject({ disposition: "needs_person", reasonCode: "no_project" });
    expect(result.workItem).toBeUndefined();
    expect(await findWorkThreadByKey(db, "bug", "issue", "1")).toBeUndefined();
    expect(await db.get("SELECT COUNT(*) AS n FROM worker_inbox")).toEqual({ n: 0 });
    await db.close();
  });
});

describe("ingest 幂等重放", () => {
  it("同一 (source, source_event_id) 重推返回首次处置,不重复开工", async () => {
    const { db, service } = await prepare();
    const first = await service.ingest(request());
    const replay = await service.ingest(request());

    expect(replay.replayed).toBe(true);
    expect(replay.trigger.id).toBe(first.trigger.id);
    expect(replay.trigger.disposition).toBe("routed");
    expect(replay.workItem?.id).toBe("wim_1");
    expect(replay.inboxIds).toEqual([]);
    expect(await db.get("SELECT COUNT(*) AS n FROM work_item")).toEqual({ n: 1 });
    expect(await db.get("SELECT COUNT(*) AS n FROM worker_inbox")).toEqual({ n: 1 });
    await db.close();
  });
});

describe("ingest needs_person 分支", () => {
  it("未知 kind:no_route_rule", async () => {
    const { db, service } = await prepare();
    const result = await service.ingest(request({ kind: "reopened" }));
    expect(result.trigger).toMatchObject({
      disposition: "needs_person",
      reasonCode: "no_route_rule",
    });
    expect(result.workItem).toBeUndefined();
    await db.close();
  });

  it("目标 Agent 未注册:target_unavailable", async () => {
    const { db, service } = await prepare({ registerAgent: false });
    const result = await service.ingest(request());
    expect(result.trigger).toMatchObject({
      disposition: "needs_person",
      reasonCode: "target_unavailable",
    });
    expect(await db.get("SELECT COUNT(*) AS n FROM work_item")).toEqual({ n: 0 });
    await db.close();
  });
});

describe("Thread owner 直通", () => {
  it("承接者已领取 assignment:后续触发落 input,同一事项续接", async () => {
    const { db, service } = await prepare();
    await service.ingest(request());
    await claimPendingForAgent(db, "agt_w", 5_000, 35_000);

    const second = await service.ingest(request({ sourceEventId: "evt-2" }));
    expect(second.replayed).toBe(false);
    expect(second.trigger).toMatchObject({
      disposition: "continued",
      reasonCode: null,
      workItemId: "wim_1",
      targetAgentId: "agt_w",
    });
    expect(second.workItem?.id).toBe("wim_1");
    expect(await db.get("SELECT COUNT(*) AS n FROM work_item")).toEqual({ n: 1 });

    const inbox = await listInboxForWorkItem(db, "wim_1");
    expect(inbox).toHaveLength(2);
    expect(inbox[1]).toMatchObject({
      kind: "input",
      targetAgentId: "agt_w",
      idempotencyKey: "input:wtg_2",
    });
    const events = await listWorkItemEvents(db, "wim_1");
    expect(events.map((event) => event.kind)).toEqual(["routed", "assigned", "input"]);
    await db.close();
  });

  it("无活跃承接者:owner_unassigned 交人", async () => {
    const { db, service } = await prepare();
    await service.ingest(request());

    const second = await service.ingest(request({ sourceEventId: "evt-2" }));
    expect(second.trigger).toMatchObject({
      disposition: "needs_person",
      reasonCode: "owner_unassigned",
      workItemId: "wim_1",
    });
    expect(await db.get("SELECT COUNT(*) AS n FROM worker_inbox")).toEqual({ n: 1 });
    await db.close();
  });

  it("owner 事项已结束:owner_closed 交人,不自动换绑", async () => {
    const { db, service } = await prepare();
    await service.ingest(request());
    await db.run("UPDATE work_item SET status = 'cancelled', ended_at = 5_000 WHERE id = 'wim_1'");

    const second = await service.ingest(request({ sourceEventId: "evt-2" }));
    expect(second.trigger).toMatchObject({
      disposition: "needs_person",
      reasonCode: "owner_closed",
    });
    const item = await findWorkItemById(db, "wim_1");
    expect(item?.status).toBe("cancelled");
    await db.close();
  });
});
