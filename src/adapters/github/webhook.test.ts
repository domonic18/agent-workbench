import { describe, expect, it } from "vitest";
import type { ThreadRef } from "../../domain/routing/router.js";
import { githubWebhookToWorkRequest } from "./webhook.js";

const REPO_URL = "https://github.com/octocat/demo";
const PR_API_URL = "https://api.github.com/repos/octocat/demo/pulls/12";
const ISSUE_URL = `${REPO_URL}/issues/12`;

function pullRequestPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "opened",
    pull_request: {
      number: 12,
      url: PR_API_URL,
      html_url: `${REPO_URL}/pull/12`,
      title: "fix: 登录页 500",
      body: "修复登录页 500。\n\nFixes #12",
      head: { sha: "abc123" },
      user: { login: "worker-bot" },
      updated_at: "2026-11-05T10:00:00Z",
    },
    repository: { full_name: "octocat/demo", html_url: REPO_URL },
    sender: { login: "worker-bot" },
    ...overrides,
  };
}

function checkSuitePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    repository: { full_name: "octocat/demo", html_url: REPO_URL },
    sender: { login: "octocat" },
    ...overrides,
  };
}

describe("pull_request 归一化", () => {
  it("opened:Fixes #N 落 bug issue 线程引用,payload 带 PR 双形式地址与 head SHA", () => {
    const request = githubWebhookToWorkRequest(
      "pull_request",
      "d-1",
      pullRequestPayload(),
      { now: () => 999 },
    );
    expect(request).toMatchObject({
      source: "github",
      sourceEventId: "d-1",
      kind: "pr.opened",
      occurredAt: Date.parse("2026-11-05T10:00:00Z"),
      actor: { login: "worker-bot" },
      threadRefs: [{ source: "bug", externalKind: "issue", externalKey: ISSUE_URL }],
      payload: {
        pr_number: 12,
        pr_url: `${REPO_URL}/pull/12`,
        pr_api_url: PR_API_URL,
        head_sha: "abc123",
      },
      refs: [`${REPO_URL}/pull/12`],
    });
  });

  it("synchronize 与 closed 各归各的 kind,closed 带 merged", () => {
    const synced = githubWebhookToWorkRequest(
      "pull_request",
      "d-2",
      pullRequestPayload({ action: "synchronize" }),
    );
    expect(synced?.kind).toBe("pr.synchronized");

    const closed = githubWebhookToWorkRequest("pull_request", "d-3", pullRequestPayload({ action: "closed", pull_request: { number: 12, url: PR_API_URL, html_url: `${REPO_URL}/pull/12`, body: "Fixes #12", head: { sha: "abc123" }, merged: true, updated_at: "2026-11-05T10:00:00Z" } }));
    expect(closed).toMatchObject({ kind: "pr.closed" });
    expect(closed?.payload).toMatchObject({ merged: true });
  });

  it("正文无关闭关键词时 threadRefs 为空;多个 Fixes 去重后全收", () => {
    const none = githubWebhookToWorkRequest(
      "pull_request",
      "d-4",
      pullRequestPayload({ pull_request: { number: 12, url: PR_API_URL, html_url: `${REPO_URL}/pull/12`, body: "顺手重构", head: { sha: "abc123" }, updated_at: "2026-11-05T10:00:00Z" } }),
    );
    expect(none?.threadRefs).toEqual([]);

    const many = githubWebhookToWorkRequest(
      "pull_request",
      "d-5",
      pullRequestPayload({ pull_request: { number: 12, url: PR_API_URL, html_url: `${REPO_URL}/pull/12`, body: "Fixes #12 and closes #13, fixes #12 again, resolves #14", head: { sha: "abc123" }, updated_at: "2026-11-05T10:00:00Z" } }),
    );
    expect(
      (many?.threadRefs ?? []).map((ref: ThreadRef) => ref.externalKey),
    ).toEqual([ISSUE_URL, `${REPO_URL}/issues/13`, `${REPO_URL}/issues/14`]);
  });

  it("缺关键字段返回 null,不产出半截事实", () => {
    expect(
      githubWebhookToWorkRequest("pull_request", "d-6", {
        action: "opened",
        pull_request: { number: 12, html_url: `${REPO_URL}/pull/12` },
        repository: { html_url: REPO_URL },
      }),
    ).toBeNull();
  });

  it("其余 action(labeled/reopened 等)与非 pull_request 事件忽略", () => {
    expect(
      githubWebhookToWorkRequest("pull_request", "d-7", pullRequestPayload({ action: "labeled" })),
    ).toBeNull();
    expect(githubWebhookToWorkRequest("issues", "d-8", { action: "opened" })).toBeNull();
  });

  it("时间戳缺失时回退注入的 now", () => {
    const request = githubWebhookToWorkRequest(
      "pull_request",
      "d-9",
      pullRequestPayload({ pull_request: { number: 12, url: PR_API_URL, html_url: `${REPO_URL}/pull/12`, body: "Fixes #12", head: { sha: "abc123" }, updated_at: "not-a-date" } }),
      { now: () => 42_000 },
    );
    expect(request?.occurredAt).toBe(42_000);
  });
});

describe("check_suite 归一化", () => {
  it("completed:PR 线程引用用 api url 形式,与 pull_request 侧同构", () => {
    const request = githubWebhookToWorkRequest("check_suite", "d-10", checkSuitePayload());
    expect(request).toMatchObject({
      source: "github",
      sourceEventId: "d-10",
      kind: "check.completed",
      threadRefs: [{ source: "github", externalKind: "pull_request", externalKey: PR_API_URL }],
      payload: {
        head_sha: "abc123",
        conclusion: "success",
        check_suite_url: "https://api.github.com/repos/octocat/demo/check-suites/99",
        pr_api_urls: [PR_API_URL],
      },
    });
  });

  it("无关联 PR 的 suite(直推 main)返回 null", () => {
    const noPr = checkSuitePayload({ check_suite: { head_sha: "abc123", conclusion: "success", url: "https://api.github.com/repos/octocat/demo/check-suites/98", updated_at: "2026-11-05T10:05:00Z", pull_requests: [] } });
    expect(githubWebhookToWorkRequest("check_suite", "d-11", noPr)).toBeNull();
  });

  it("非 completed action(requested/rerequested)忽略", () => {
    expect(
      githubWebhookToWorkRequest("check_suite", "d-12", checkSuitePayload({ action: "requested" })),
    ).toBeNull();
  });
});
