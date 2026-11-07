import { createHmac } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret1234567";
const NOW = 5_000;
const SECRET = "github-webhook-secret";
const ISSUE_URL = "https://github.com/octocat/demo/issues/12";
const PR_API_URL = "https://api.github.com/repos/octocat/demo/pulls/12";

function sign(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

async function prepare(): Promise<Db> {
  const db = await openDatabase();
  await ensureConsoleCredential(db, PASSWORD);
  return db;
}

function cookieOf(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    throw new Error("响应没有 set-cookie");
  }
  return value.split(";")[0] as string;
}

function bugTriggerBody(): Record<string, unknown> {
  return {
    source: "bug",
    sourceEventId: "bug-evt-1",
    kind: "submitted",
    occurredAt: NOW,
    actor: { user: "tester" },
    project: "workbuddy-pilot",
    threadRefs: [{ source: "bug", externalKind: "issue", externalKey: ISSUE_URL }],
    payload: { title: "登录页 500" },
    refs: [],
  };
}

function prOpenedPayload(): Record<string, unknown> {
  return {
    action: "opened",
    pull_request: {
      number: 12,
      url: PR_API_URL,
      html_url: "https://github.com/octocat/demo/pull/12",
      title: "fix: 登录页 500",
      body: "修复登录页 500。\n\nFixes #12",
      head: { sha: "abc123" },
      user: { login: "worker-bot" },
      updated_at: "2026-11-05T10:00:00Z",
    },
    repository: { full_name: "octocat/demo", html_url: "https://github.com/octocat/demo" },
    sender: { login: "worker-bot" },
  };
}

function checkSuitePayload(): Record<string, unknown> {
  return {
    action: "completed",
    check_suite: {
      head_sha: "abc123",
      conclusion: "success",
      status: "completed",
      url: "https://api.github.com/repos/octocat/demo/check-suites/99",
      updated_at: "2026-11-05T10:05:00Z",
      pull_requests: [{ url: PR_API_URL, number: 12 }],
    },
    repository: { full_name: "octocat/demo", html_url: "https://github.com/octocat/demo" },
    sender: { login: "octocat" },
  };
}

describe("POST /api/webhooks/github", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;
  let keySeq = 0;

  function post(
    event: string,
    delivery: string,
    body: Record<string, unknown> | string,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    return app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-github-delivery": delivery,
        "x-hub-signature-256": sign(raw),
        ...headers,
      },
      payload: raw,
    });
  }

  beforeEach(async () => {
    db = await prepare();
    app = buildApp({ logLevel: "silent", db, now: () => NOW, githubWebhookSecret: SECRET });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    cookie = cookieOf(login);
    const register = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: {
        cookie,
        "x-requested-with": "fetch",
        "idempotency-key": `wh-key-${++keySeq}`,
      },
      payload: {
        runtime: "workbuddy",
        key: "workbuddy-pilot",
        project: "workbuddy-pilot",
        displayName: "Pilot Worker",
      },
    });
    expect(register.statusCode).toBe(201);
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  it("反例:无签名、坏签名、坏密钥一律 401;验签用的就是原始请求体", async () => {
    const raw = JSON.stringify(prOpenedPayload());
    const missing = await app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: { "content-type": "application/json", "x-github-event": "pull_request", "x-github-delivery": "w-1" },
      payload: raw,
    });
    expect(missing.statusCode).toBe(401);

    const tampered = await post("pull_request", "w-2", prOpenedPayload(), {
      "x-hub-signature-256": "sha256=" + "0".repeat(64),
    });
    expect(tampered.statusCode).toBe(401);

    // 签名对但正文改了一个字节:同签名过不了(证明验签对象是原文)
    const shifted = await app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-github-delivery": "w-3",
        "x-hub-signature-256": sign(raw),
      },
      payload: `${raw} `,
    });
    expect(shifted.statusCode).toBe(401);
  });

  it("签名有效但正文不是 JSON 时 400,不进归一化", async () => {
    const response = await post("pull_request", "w-4", "not-json");
    expect(response.statusCode).toBe(400);
  });

  it("未订阅的事件(push 等)返回 ignored,不落任何触发", async () => {
    const response = await post("push", "w-5", {
      repository: { full_name: "octocat/demo" },
      sender: { login: "octocat" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ignored: true });
    expect(await db.get("SELECT COUNT(*) AS n FROM work_trigger")).toEqual({ n: 0 });
  });

  it("正例全链:bug 建单 → PR(Fixes)续接 → CI 回流,全程不新增投递行", async () => {
    const trigger = await app.inject({
      method: "POST",
      url: "/api/work/triggers",
      headers: { cookie, "x-requested-with": "fetch", "idempotency-key": "wh-bug-1" },
      payload: bugTriggerBody(),
    });
    expect(trigger.statusCode).toBe(200);
    const workItemId = (
      trigger.json() as { workItem: { id: string } | null }
    ).workItem?.id;

    const pr = await post("pull_request", "gh-delivery-1", prOpenedPayload());
    expect(pr.statusCode).toBe(200);
    expect(pr.json()).toMatchObject({
      replayed: false,
      disposition: "continued",
      reasonCode: null,
      workItemId,
    });

    const replay = await post("pull_request", "gh-delivery-1", prOpenedPayload());
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { replayed: boolean }).replayed).toBe(true);

    const ci = await post("check_suite", "gh-delivery-2", checkSuitePayload());
    expect(ci.statusCode).toBe(200);
    expect(ci.json()).toMatchObject({ disposition: "continued", workItemId });

    // 只有 bug 建单时的 assignment;证据分支零投递
    expect(await db.get("SELECT COUNT(*) AS n FROM worker_inbox")).toEqual({ n: 1 });
    const events = (
      await db.all("SELECT kind FROM work_item_event WHERE work_item_id = ? ORDER BY seq", workItemId)
    ).map((row) => (row as { kind: string }).kind);
    expect(events).toEqual(["routed", "assigned", "pr_linked", "acceptance_ready"]);

    const detail = await app.inject({
      method: "GET",
      url: `/api/work-items/${workItemId}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect((detail.json() as { workItem: { stage: string; attention: string } }).workItem).toMatchObject({
      stage: "review",
      attention: "acceptance",
    });
  });

  it("无 Fixes 的 PR 无订阅:needs_person 落库即止", async () => {
    const trigger = await app.inject({
      method: "POST",
      url: "/api/work/triggers",
      headers: { cookie, "x-requested-with": "fetch", "idempotency-key": "wh-bug-2" },
      payload: bugTriggerBody(),
    });
    expect(trigger.statusCode).toBe(200);

    const payload = prOpenedPayload();
    (payload.pull_request as Record<string, unknown>).body = "顺手重构,不关联 issue";
    const response = await post("pull_request", "gh-delivery-3", payload);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      disposition: "needs_person",
      reasonCode: "no_route_rule",
      workItemId: null,
    });
    expect(await db.get("SELECT COUNT(*) AS n FROM work_item")).toEqual({ n: 1 });
    expect(await db.get("SELECT COUNT(*) AS n FROM worker_inbox")).toEqual({ n: 1 });
  });
});
