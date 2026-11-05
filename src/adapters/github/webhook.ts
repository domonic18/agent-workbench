import type { ThreadRef } from "../../domain/routing/router.js";
import type { WorkRequest } from "../../domain/work/contract.js";

/**
 * GitHub Webhook 归一化(arch/01 §9.1 可信 Source 适配器):只整理事实,
 * 不查库、不做判定。source_event_id 用 X-GitHub-Delivery,同一 delivery
 * 重推在 ingest 事务内幂等。不认识的事件返回 null,由端点 200 忽略。
 * PR 线程键用 api.github.com 的 url 形式——check_suite 的 pull_requests
 * 只携带这种形式,两侧必须一致才能回流到同一事项。
 */

const CLOSING_ISSUE_PATTERN = /(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s*:?\s+#(\d+)/gi;
const MAX_ISSUE_REFS = 5;
const MAX_PR_REFS = 3;

export interface GithubWebhookOptions {
  now?: () => number;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function occurredAtOf(candidate: unknown, fallback: () => number): number {
  const raw = text(candidate);
  if (raw !== undefined) {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback();
}

/** PR 正文的关闭关键词 → bug issue 线程引用;键与 bug.submitted 的 issue URL 同构 */
function closingIssueRefs(body: string, repoUrl: string): ThreadRef[] {
  const seen = new Set<string>();
  const refs: ThreadRef[] = [];
  for (const match of body.matchAll(CLOSING_ISSUE_PATTERN)) {
    const number = match[1];
    if (number === undefined || seen.has(number)) {
      continue;
    }
    seen.add(number);
    refs.push({ source: "bug", externalKind: "issue", externalKey: `${repoUrl}/issues/${number}` });
    if (refs.length >= MAX_ISSUE_REFS) {
      break;
    }
  }
  return refs;
}

export function githubWebhookToWorkRequest(
  event: string,
  deliveryId: string,
  payload: Record<string, unknown>,
  options: GithubWebhookOptions = {},
): WorkRequest | null {
  const fallbackNow = options.now ?? Date.now;
  const actor = { login: text(record(payload.sender).login) ?? null };

  if (event === "pull_request") {
    const action = text(payload.action);
    if (action !== "opened" && action !== "synchronize" && action !== "closed") {
      return null;
    }
    const pr = record(payload.pull_request);
    const repoUrl = text(record(payload.repository).html_url);
    const prNumber = typeof pr.number === "number" ? pr.number : undefined;
    const prApiUrl = text(pr.url);
    const prUrl = text(pr.html_url);
    const headSha = text(record(pr.head).sha);
    if (repoUrl === undefined || prNumber === undefined || prApiUrl === undefined || prUrl === undefined || headSha === undefined) {
      return null;
    }
    const kind =
      action === "opened" ? "pr.opened" : action === "synchronize" ? "pr.synchronized" : "pr.closed";
    return {
      source: "github",
      sourceEventId: deliveryId,
      kind,
      occurredAt: occurredAtOf(pr.updated_at, fallbackNow),
      actor,
      threadRefs: closingIssueRefs(typeof pr.body === "string" ? pr.body : "", repoUrl),
      payload: {
        pr_number: prNumber,
        pr_url: prUrl,
        pr_api_url: prApiUrl,
        head_sha: headSha,
        title: text(pr.title) ?? null,
        ...(action === "closed" ? { merged: pr.merged === true } : {}),
      },
      refs: [prUrl],
    };
  }

  if (event === "check_suite") {
    if (text(payload.action) !== "completed") {
      return null;
    }
    const suite = record(payload.check_suite);
    const headSha = text(suite.head_sha);
    const suiteUrl = text(suite.url);
    if (headSha === undefined || suiteUrl === undefined) {
      return null;
    }
    const prList = Array.isArray(suite.pull_requests) ? suite.pull_requests : [];
    const prApiUrls = prList
      .map((entry) => text(record(entry).url))
      .filter((url): url is string => url !== undefined)
      .slice(0, MAX_PR_REFS);
    // 无关联 PR 的 suite(如直推 main)没有回流对象,忽略而不是制造 needs_person 噪声
    if (prApiUrls.length === 0) {
      return null;
    }
    return {
      source: "github",
      sourceEventId: deliveryId,
      kind: "check.completed",
      occurredAt: occurredAtOf(suite.updated_at, fallbackNow),
      actor,
      threadRefs: prApiUrls.map((url) => ({
        source: "github",
        externalKind: "pull_request",
        externalKey: url,
      })),
      payload: {
        head_sha: headSha,
        conclusion: text(suite.conclusion) ?? null,
        check_suite_url: suiteUrl,
        pr_api_urls: prApiUrls,
      },
      refs: [suiteUrl],
    };
  }

  return null;
}
