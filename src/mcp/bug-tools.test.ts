import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { createA2aService } from "../domain/a2a/service.js";
import { createTaskService } from "../domain/task/service.js";
import { createIngestService } from "../domain/work/ingest-service.js";
import { WorkError } from "../domain/work/errors.js";
import { createWorkerService } from "../domain/work/worker-service.js";
import { openDatabase, type Db } from "../store/database.js";
import {
  findAgentById,
  insertAgent,
  type AgentRecord,
  type NewAgent,
} from "../store/repositories/agent.js";
import { claimPendingForAgent } from "../store/repositories/work-inbox.js";
import { findWorkItemById } from "../store/repositories/work-item.js";
import { createBugTools } from "./bug-tools.js";

const PROJECT = "workbuddy-pilot";
const ISSUE = "https://github.com/octocat/demo/issues/12";

function botAgent(id: string, overrides: Partial<Omit<NewAgent, "id">>): NewAgent {
  return {
    id,
    machineId: null,
    runtime: "claude_code",
    project: "workbuddy-pilot",
    displayName: "bot",
    secretHash: null,
    feishuAppId: null,
    allowedTargetsJson: "[]",
    createdAt: 1_000,
    ...overrides,
  };
}

interface Fixture {
  db: Db;
  bot: AgentRecord;
  otherBot: AgentRecord;
  report: (agent: AgentRecord, args?: Record<string, unknown>) => Promise<CallToolResult>;
  decide: (agent: AgentRecord, args: Record<string, unknown>) => Promise<CallToolResult>;
}

async function setup(): Promise<Fixture> {
  const db = await openDatabase();
  await insertAgent(
    db,
    botAgent("agt_worker", { key: "workbuddy-pilot", displayName: "Worker" }),
  );
  await insertAgent(
    db,
    botAgent("agt_bug", { key: "bug-triage", displayName: "Bug Bot" }),
  );
  await insertAgent(
    db,
    botAgent("agt_other", { key: "other-bot", displayName: "Other Bot" }),
  );
  const bot = await findAgentById(db, "agt_bug");
  const otherBot = await findAgentById(db, "agt_other");
  if (bot === undefined || otherBot === undefined) {
    throw new Error("测试 Agent 回读失败");
  }
  const knowledgeDir = mkdtempSync(join(tmpdir(), "aw-kb-"));
  const counters = new Map<string, number>();
  const next = (prefix: string) => () => {
    const seq = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, seq);
    return `${prefix}_${seq}`;
  };
  const tools = createBugTools({
    db,
    tasks: createTaskService({ db, now: () => 5_000 }),
    a2a: createA2aService({ db, now: () => 5_000, waitMs: 0 }),
    workers: createWorkerService({ db, now: () => 5_000, sleep: async () => {} }),
    ingest: createIngestService({
      db,
      now: () => 5_000,
      newTriggerId: next("wtg"),
      newItemId: next("wim"),
      newEventId: next("wev"),
      newInboxId: next("wib"),
      newThreadId: next("wth"),
      newSubscriptionId: next("wsb"),
    }).ingest,
    now: () => 5_000,
    knowledgeDir,
    announce: { db },
  });
  const byName = (name: string) => {
    const tool = tools.find((entry) => entry.name === name);
    if (tool === undefined) {
      throw new Error(`工具 ${name} 缺失`);
    }
    return tool;
  };
  const reportTool = byName("work_report");
  const decideTool = byName("work_decide");
  return {
    db,
    bot,
    otherBot,
    report: (agent, args = {}) =>
      reportTool.execute(agent, {
        project: PROJECT,
        title: "登录页 500",
        issue_ref: ISSUE,
        thread_key: "oc_chat:om_msg",
        ...args,
      }),
    decide: (agent, args) => decideTool.execute(agent, args),
  };
}

function body(result: CallToolResult): Record<string, unknown> {
  const first = result.content[0];
  if (first === undefined || first.type !== "text") {
    throw new Error("工具无文本输出");
  }
  return JSON.parse(first.text) as Record<string, unknown>;
}

async function rejectCode(promise: Promise<CallToolResult>): Promise<WorkError["code"]> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof WorkError)) {
    throw new Error(`预期 WorkError,得到: ${String(error)}`);
  }
  return error.code;
}

describe("work_report", () => {
  it("上报建单全链:actor 记 bot 身份,worker 收到 assignment,重报幂等", async () => {
    const { db, bot, report } = await setup();
    const first = body(await report(bot));
    expect(first).toMatchObject({ replayed: false, disposition: "routed" });
    expect((first.work_item as { id: string }).id).toBe("wim_1");

    const trigger = (await db.get(
      "SELECT actor_json AS actor, source_event_id AS eid FROM work_trigger WHERE id = 'wtg_1'",
    )) as { actor: string; eid: string };
    expect(JSON.parse(trigger.actor)).toEqual({ agent_id: "agt_bug", agent_key: "bug-triage" });
    expect(trigger.eid).toBe(`report:${ISSUE}`);
    expect(
      await db.get(
        "SELECT kind, target_agent_id AS t FROM worker_inbox WHERE work_item_id = 'wim_1'",
      ),
    ).toEqual({ kind: "assignment", t: "agt_worker" });

    const replay = body(await report(bot));
    expect(replay).toMatchObject({ replayed: true, disposition: "routed" });
    await db.close();
  });

  it("未登记项目拒绝,不落触发", async () => {
    const { db, bot, report } = await setup();
    const result = await report(bot, { project: "no-such-project" });
    expect(result.isError).toBe(true);
    expect(await db.get("SELECT COUNT(*) AS n FROM work_trigger")).toEqual({ n: 0 });
    await db.close();
  });
});

describe("work_decide", () => {
  it("非上报 bot 无权裁决:FORBIDDEN", async () => {
    const { db, bot, otherBot, report, decide } = await setup();
    await report(bot);
    expect(await rejectCode(decide(otherBot, { action: "accepted", issue_ref: ISSUE }))).toBe(
      "FORBIDDEN",
    );
    expect(await findWorkItemById(db, "wim_1")).toMatchObject({ status: "open" });
    await db.close();
  });

  it("unknown issue 与缺 reason 分别 NOT_FOUND / 参数错误", async () => {
    const { db, bot, decide } = await setup();
    expect(
      await rejectCode(decide(bot, { action: "accepted", issue_ref: "https://x/i/1" })),
    ).toBe("NOT_FOUND");
    const missingReason = await decide(bot, { action: "returned", issue_ref: ISSUE });
    expect(missingReason.isError).toBe(true);
    await db.close();
  });

  it("accepted:原 bot 收口事项,acceptance_ref 落账", async () => {
    const { db, bot, report, decide } = await setup();
    await report(bot);
    const result = body(await decide(bot, { action: "accepted", issue_ref: ISSUE, message_id: "om_1" }));
    expect(result).toMatchObject({ ok: true, disposition: "continued" });
    expect(result.work_item).toMatchObject({ id: "wim_1", status: "done", attention: "none" });

    const item = await findWorkItemById(db, "wim_1");
    expect(item?.acceptanceRef).toBe("wtg_2");
    expect(item?.endedAt).toBe(5_000);

    const again = body(await decide(bot, { action: "accepted", issue_ref: ISSUE, message_id: "om_1" }));
    expect(again).toMatchObject({ ok: true, replayed: true });
    await db.close();
  });

  it("returned:同一事项回 execute,活跃承接者收到返工 input", async () => {
    const { db, bot, report, decide } = await setup();
    await report(bot);
    await claimPendingForAgent(db, "agt_worker", 5_000, 15_000);
    const result = body(
      await decide(bot, { action: "returned", issue_ref: ISSUE, reason: "复现路径不对", message_id: "om_2" }),
    );
    expect(result).toMatchObject({ ok: true, disposition: "continued" });
    expect(result.work_item).toMatchObject({ stage: "execute", attention: "blocked" });
    expect(
      await db.get(
        "SELECT kind, target_agent_id AS t FROM worker_inbox WHERE work_item_id = 'wim_1' AND status = 'pending'",
      ),
    ).toEqual({ kind: "input", t: "agt_worker" });
    await db.close();
  });
});
