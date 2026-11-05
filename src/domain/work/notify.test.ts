import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertAgent, type NewAgent } from "../../store/repositories/identity.js";
import { findOutboxByKey } from "../../store/repositories/outbox.js";
import type { WorkPolicy } from "../routing/policy.js";
import type { WorkRequest } from "./contract.js";
import { createIngestService } from "./ingest-service.js";
import { notifyWorkEvent, type WorkNotifyKind } from "./notify.js";

const AGENT_KEY = "wb-primary";
const ISSUE_KEY = "https://github.com/octocat/demo/issues/12";
const CHAT_ID = "oc_chat_777";

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

function request(threadKey: string | undefined): WorkRequest {
  return {
    source: "bug",
    sourceEventId: "evt-1",
    kind: "submitted",
    occurredAt: 1_000,
    actor: { agent_id: "agt_bug" },
    project: "demo",
    threadRefs: [{ source: "bug", externalKind: "issue", externalKey: ISSUE_KEY }],
    payload: {
      title: "登录页 500",
      ...(threadKey === undefined ? {} : { thread_key: threadKey }),
    },
    refs: [],
  };
}

interface Fixture {
  db: Db;
  workItemId: string;
}

async function prepare(threadKey: string | undefined): Promise<Fixture> {
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
  const submitted = await service.ingest(request(threadKey));
  const workItemId = submitted.workItem?.id;
  if (workItemId === undefined) {
    throw new Error("建单失败");
  }
  return { db, workItemId };
}

interface OutboxPayload {
  chatId: string;
  text: string;
  uuid: string;
}

async function notifyOne(
  fixture: Fixture,
  eventId: string,
  kind: WorkNotifyKind,
  extra: { reason?: string; prUrl?: string } = {},
): Promise<OutboxPayload | undefined> {
  await notifyWorkEvent(fixture.db, {
    workItemId: fixture.workItemId,
    eventId,
    kind,
    now: 6_000,
    ...extra,
  });
  const row = await findOutboxByKey(fixture.db, `work-notify:${eventId}`);
  if (row === undefined) {
    return undefined;
  }
  expect(row.channel).toBe("push");
  expect(row.kind).toBe("work_notify");
  return JSON.parse(row.payloadJson) as OutboxPayload;
}

async function countOutbox(fixture: Fixture): Promise<number> {
  const row = (await fixture.db.get("SELECT COUNT(*) AS n FROM outbox")) as { n: number };
  return row.n;
}

describe("工作事项通知线 notifyWorkEvent", () => {
  it("task_bound:出队正确 chatId 与文案(含 issue 编号与标题)", async () => {
    const fixture = await prepare(`${CHAT_ID}:om_msg_888`);
    const payload = await notifyOne(fixture, "wev_n1", "task_bound");
    expect(payload).toMatchObject({ chatId: CHAT_ID, uuid: "wev_n1" });
    expect(payload?.text).toContain("Bug #12");
    expect(payload?.text).toContain("「登录页 500」");
    expect(payload?.text).toContain("已被 worker 接单");
    await fixture.db.close();
  });

  it("pr_linked:带 PR 链接", async () => {
    const fixture = await prepare(`${CHAT_ID}:om_msg_888`);
    const payload = await notifyOne(fixture, "wev_n2", "pr_linked", { prUrl: "https://github.com/o/d/pull/96" });
    expect(payload?.text).toContain("修复已提交 PR（CI 运行中）：https://github.com/o/d/pull/96");
    await fixture.db.close();
  });

  it("pr_linked:prUrl 缺失时文案省略链接", async () => {
    const fixture = await prepare(`${CHAT_ID}:om_msg_888`);
    const payload = await notifyOne(fixture, "wev_n3", "pr_linked");
    expect(payload?.text).toContain("修复已提交 PR，CI 运行中");
    expect(payload?.text).not.toContain("http");
    await fixture.db.close();
  });

  it("ci_failed:提示停留修复阶段与退回口令", async () => {
    const fixture = await prepare(`${CHAT_ID}:om_msg_888`);
    const payload = await notifyOne(fixture, "wev_n4", "ci_failed");
    expect(payload?.text).toContain("PR CI 未通过");
    expect(payload?.text).toContain("『#12 退回：理由』");
    await fixture.db.close();
  });

  it("acceptance_ready:含 PR 链接与接受/退回口令", async () => {
    const fixture = await prepare(`${CHAT_ID}:om_msg_888`);
    const payload = await notifyOne(fixture, "wev_n5", "acceptance_ready", { prUrl: "https://github.com/o/d/pull/96" });
    expect(payload?.text).toContain("CI 全绿，待验收（PR：https://github.com/o/d/pull/96）");
    expect(payload?.text).toContain("『#12 接受』");
    expect(payload?.text).toContain("『#12 退回：理由』");
    await fixture.db.close();
  });

  it("acceptance_ready:prUrl 缺省时不出现 PR 段", async () => {
    const fixture = await prepare(`${CHAT_ID}:om_msg_888`);
    const payload = await notifyOne(fixture, "wev_n6", "acceptance_ready");
    expect(payload?.text).toContain("CI 全绿，待验收。");
    expect(payload?.text).not.toContain("（PR：");
    await fixture.db.close();
  });

  it("returned:文案含退回理由;缺省时提示未注明原因", async () => {
    const fixture = await prepare(`${CHAT_ID}:om_msg_888`);
    const withReason = await notifyOne(fixture, "wev_n7", "returned", { reason: "复现路径不对" });
    expect(withReason?.text).toContain("已退回返工：复现路径不对");
    const noReason = await notifyOne(fixture, "wev_n8", "returned");
    expect(noReason?.text).toContain("已退回返工：未注明原因");
    await fixture.db.close();
  });

  it("同一 eventId 重入幂等:outbox 只留一条", async () => {
    const fixture = await prepare(`${CHAT_ID}:om_msg_888`);
    await notifyOne(fixture, "wev_n9", "task_bound");
    await notifyWorkEvent(fixture.db, { workItemId: fixture.workItemId, eventId: "wev_n9", kind: "task_bound", now: 7_000 });
    expect(await countOutbox(fixture)).toBe(1);
    await fixture.db.close();
  });

  it("thread_key 缺失 / no-thread: / 无冒号:均静默跳过不出队", async () => {
    for (const threadKey of [undefined, "no-thread:manual", "garbage"]) {
      const fixture = await prepare(threadKey);
      const payload = await notifyOne(fixture, `wev_skip_${String(threadKey)}`, "task_bound");
      expect(payload).toBeUndefined();
      expect(await countOutbox(fixture)).toBe(0);
      await fixture.db.close();
    }
  });

  it("thread_key 只给 chat_id(无 message_id):照常定位到群", async () => {
    const fixture = await prepare(CHAT_ID);
    const payload = await notifyOne(fixture, "wev_chat_only", "task_bound");
    expect(payload?.chatId).toBe(CHAT_ID);
    await fixture.db.close();
  });

  it("issue 引用缺失:文案退化无编号,口令不带 #", async () => {
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
    const submitted = await service.ingest({
      ...request(`${CHAT_ID}:om_msg_888`),
      threadRefs: [],
    });
    const workItemId = submitted.workItem?.id;
    if (workItemId === undefined) {
      throw new Error("建单失败");
    }
    await notifyWorkEvent(db, { workItemId, eventId: "wev_noissue", kind: "acceptance_ready", now: 6_000 });
    const row = await findOutboxByKey(db, "work-notify:wev_noissue");
    const payload = JSON.parse(row?.payloadJson ?? "{}") as OutboxPayload;
    expect(payload.chatId).toBe(CHAT_ID);
    expect(payload.text).not.toContain("Bug #");
    expect(payload.text).toContain("『接受』");
    expect(payload.text).toContain("『退回：理由』");
    await db.close();
  });

  it("事项不存在:静默跳过", async () => {
    const fixture = await prepare(`${CHAT_ID}:om_msg_888`);
    await notifyWorkEvent(fixture.db, { workItemId: "wim_missing", eventId: "wev_ghost", kind: "task_bound" });
    expect(await findOutboxByKey(fixture.db, "work-notify:wev_ghost")).toBeUndefined();
    await fixture.db.close();
  });
});
