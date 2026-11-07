import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertAgent, type NewAgent } from "../../store/repositories/agent.js";
import { findOutboxByKey } from "../../store/repositories/outbox.js";
import {
  ackInbox,
  claimPendingForAgent,
  type WorkerInboxRecord,
} from "../../store/repositories/work-inbox.js";
import type { WorkPolicy } from "../routing/policy.js";
import type { WorkRequest } from "./contract.js";
import { createIngestService } from "./ingest-service.js";
import { notifyWorkEvent, type WorkNotifyKind } from "./notify.js";

const AGENT_KEY = "wb-primary";
const AGENT_ID = "agt_w";
const ASSIGNEE_NAME = "acore-portal";
const ISSUE_KEY = "https://github.com/octocat/demo/issues/12";
const CHAT_ID = "oc_collab_777";

function workAgent(): NewAgent {
  return {
    id: AGENT_ID,
    machineId: null,
    runtime: "workbuddy",
    project: "demo",
    displayName: ASSIGNEE_NAME,
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

function request(threadRefs = true): WorkRequest {
  return {
    source: "bug",
    sourceEventId: "evt-1",
    kind: "submitted",
    occurredAt: 1_000,
    actor: { agent_id: "agt_bug" },
    project: "demo",
    threadRefs: threadRefs
      ? [{ source: "bug", externalKind: "issue", externalKey: ISSUE_KEY }]
      : [],
    payload: { title: "登录页 500" },
    refs: [],
  };
}

interface Fixture {
  db: Db;
  workItemId: string;
}

async function prepare(withIssueRef = true): Promise<Fixture> {
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
  const submitted = await service.ingest(request(withIssueRef));
  const workItemId = submitted.workItem?.id;
  if (workItemId === undefined) {
    throw new Error("建单失败");
  }
  return { db, workItemId };
}

/** 把 assignment 领到 acked,让通知能解析出接单的机器人 */
async function acceptAssignment(fixture: Fixture): Promise<void> {
  const claimed: WorkerInboxRecord[] = await claimPendingForAgent(
    fixture.db,
    AGENT_ID,
    6_000,
    6_000 + 60_000,
  );
  const row = claimed[0];
  if (row === undefined) {
    throw new Error("没有待领的 assignment");
  }
  await ackInbox(fixture.db, row.id, row.leaseToken, null, 6_000);
}

interface CardView {
  title: string;
  template: string;
  body: string;
}

interface OutboxPayload {
  chatId: string;
  card?: { header?: { title?: { content?: string }; template?: string }; body?: { elements?: Array<{ content?: string }> } };
  uuid?: string;
}

function readCard(payload: OutboxPayload | undefined): CardView {
  if (payload?.card === undefined) {
    throw new Error("payload 无 card");
  }
  const header = payload.card.header;
  const body = payload.card.body?.elements?.[0]?.content ?? "";
  return {
    title: header?.title?.content ?? "",
    template: header?.template ?? "",
    body,
  };
}

async function notifyOne(
  fixture: Fixture,
  eventId: string,
  kind: WorkNotifyKind,
  extra: { reason?: string | undefined; prUrl?: string | undefined; chatId?: string | undefined } = {},
): Promise<OutboxPayload | undefined> {
  await notifyWorkEvent(fixture.db, {
    workItemId: fixture.workItemId,
    eventId,
    kind,
    chatId: extra.chatId === undefined ? CHAT_ID : extra.chatId,
    now: 7_000,
    ...(extra.reason === undefined ? {} : { reason: extra.reason }),
    ...(extra.prUrl === undefined ? {} : { prUrl: extra.prUrl }),
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
  it("task_bound:卡片标题带接单机器人名与事项标题,正文带缺陷编号", async () => {
    const fixture = await prepare();
    await acceptAssignment(fixture);
    const payload = await notifyOne(fixture, "wev_n1", "task_bound");
    expect(payload?.chatId).toBe(CHAT_ID);
    expect(payload?.uuid).toBe("wev_n1");
    const card = readCard(payload);
    expect(card.title).toContain(ASSIGNEE_NAME);
    expect(card.title).toContain("已接单");
    expect(card.template).toBe("turquoise");
    expect(card.body).toContain("Bug #12");
    expect(card.body).toContain("登录页 500");
    expect(card.body).toContain("开始修复");
    expect(card.body).not.toContain("worker");
    await fixture.db.close();
  });

  it("pr_linked:正文带 PR 链接", async () => {
    const fixture = await prepare();
    await acceptAssignment(fixture);
    const payload = await notifyOne(fixture, "wev_n2", "pr_linked", {
      prUrl: "https://github.com/o/d/pull/96",
    });
    const card = readCard(payload);
    expect(card.template).toBe("blue");
    expect(card.body).toContain("https://github.com/o/d/pull/96");
    expect(card.body).toContain("CI 运行中");
    await fixture.db.close();
  });

  it("pr_linked:prUrl 缺失时正文省略 PR 段", async () => {
    const fixture = await prepare();
    await acceptAssignment(fixture);
    const payload = await notifyOne(fixture, "wev_n3", "pr_linked");
    const card = readCard(payload);
    expect(card.body).not.toContain("http");
    expect(card.body).not.toContain("**PR**");
    await fixture.db.close();
  });

  it("ci_failed:提示停留修复阶段与退回口令", async () => {
    const fixture = await prepare();
    await acceptAssignment(fixture);
    const payload = await notifyOne(fixture, "wev_n4", "ci_failed");
    const card = readCard(payload);
    expect(card.template).toBe("red");
    expect(card.body).toContain("CI 未通过");
    await fixture.db.close();
  });

  it("acceptance_ready:正文含接受/退回口令", async () => {
    const fixture = await prepare();
    await acceptAssignment(fixture);
    const payload = await notifyOne(fixture, "wev_n5", "acceptance_ready", {
      prUrl: "https://github.com/o/d/pull/96",
    });
    const card = readCard(payload);
    expect(card.template).toBe("green");
    expect(card.body).toContain("https://github.com/o/d/pull/96");
    expect(card.body).toContain("#12 接受");
    expect(card.body).toContain("#12 退回：理由");
    await fixture.db.close();
  });

  it("returned:正文含退回理由;缺省时提示未注明原因", async () => {
    const fixture = await prepare();
    await acceptAssignment(fixture);
    const withReason = readCard(
      await notifyOne(fixture, "wev_n6", "returned", { reason: "复现路径不对" }),
    );
    expect(withReason.template).toBe("orange");
    expect(withReason.body).toContain("复现路径不对");
    const noReason = readCard(await notifyOne(fixture, "wev_n7", "returned"));
    expect(noReason.body).toContain("未注明原因");
    await fixture.db.close();
  });

  it("accepted:正文表明人工接受与收口", async () => {
    const fixture = await prepare();
    await acceptAssignment(fixture);
    const payload = await notifyOne(fixture, "wev_n11", "accepted");
    const card = readCard(payload);
    expect(card.template).toBe("indigo");
    expect(card.title).toContain("已验收");
    expect(card.body).toContain("已收口");
    await fixture.db.close();
  });

  it("同一 eventId 重入幂等:outbox 只留一条", async () => {
    const fixture = await prepare();
    await acceptAssignment(fixture);
    await notifyOne(fixture, "wev_n8", "task_bound");
    await notifyWorkEvent(fixture.db, {
      workItemId: fixture.workItemId,
      eventId: "wev_n8",
      kind: "task_bound",
      chatId: CHAT_ID,
      now: 8_000,
    });
    expect(await countOutbox(fixture)).toBe(1);
    await fixture.db.close();
  });

  it("协作群未配置:静默跳过不出队", async () => {
    const fixture = await prepare();
    await acceptAssignment(fixture);
    await notifyWorkEvent(fixture.db, {
      workItemId: fixture.workItemId,
      eventId: "wev_n9",
      kind: "task_bound",
      chatId: undefined,
    });
    expect(await findOutboxByKey(fixture.db, "work-notify:wev_n9")).toBeUndefined();
    expect(await countOutbox(fixture)).toBe(0);
    await fixture.db.close();
  });

  it("issue 引用缺失:正文退化无编号,口令不带 #", async () => {
    const fixture = await prepare(false);
    await acceptAssignment(fixture);
    const payload = await notifyOne(fixture, "wev_n10", "acceptance_ready");
    const card = readCard(payload);
    expect(card.body).not.toContain("Bug #");
    expect(card.body).toContain("『接受』");
    expect(card.body).toContain("『退回：理由』");
    await fixture.db.close();
  });

  it("事项不存在:静默跳过", async () => {
    const fixture = await prepare();
    await notifyWorkEvent(fixture.db, {
      workItemId: "wim_missing",
      eventId: "wev_ghost",
      kind: "task_bound",
      chatId: CHAT_ID,
    });
    expect(await findOutboxByKey(fixture.db, "work-notify:wev_ghost")).toBeUndefined();
    await fixture.db.close();
  });
});
