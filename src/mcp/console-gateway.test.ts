import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import type { UsageState } from "../domain/capability/gate.js";
import { createA2aService } from "../domain/a2a/service.js";
import { createIdentityService } from "../domain/identity/service.js";
import { createTaskService } from "../domain/task/service.js";
import { createIngestService } from "../domain/work/ingest-service.js";
import { createWorkerService } from "../domain/work/worker-service.js";
import { openDatabase, type Db } from "../store/database.js";
import type { AgentRecord } from "../store/repositories/identity.js";
import { createConsoleGateway } from "./console-gateway.js";
import { createConsoleTools } from "./console-tools.js";

interface Fixture {
  db: Db;
  agent: AgentRecord;
  gateway: ReturnType<typeof createConsoleGateway>;
  knowledgeDir: string;
}

async function setup(usage?: UsageState): Promise<Fixture> {
  const db = await openDatabase();
  const ids = ["agt_a", "agt_b", "agt_c"];
  let seq = 0;
  const identity = createIdentityService({
    db,
    newAgentId: () => ids[seq++] ?? "agt_x",
    newSecret: () => "secret-a",
  });
  await identity.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
  const agentA = await identity.registerAgent({
    machineId: "m1",
    project: "pa",
    displayName: "Agent A",
    allowedTargets: ["agt_b"],
  });
  await identity.registerAgent({ machineId: "m1", project: "pb", displayName: "Agent B" });
  await identity.registerAgent({ machineId: "m1", project: "pc", displayName: "Agent C" });

  const knowledgeDir = mkdtempSync(join(tmpdir(), "aw-kb-"));
  const tasks = createTaskService({ db, now: () => 0 });
  const a2a = createA2aService({ db, now: () => 0, waitMs: 0 });
  const workers = createWorkerService({ db, now: () => 0, sleep: async () => {} });
  const gateway = createConsoleGateway({
    db,
    tools: createConsoleTools({
      db,
      tasks,
      a2a,
      workers,
      ingest: createIngestService({ db, now: () => 0 }).ingest,
      now: () => 0,
      knowledgeDir,
      announce: { db },
    }),
    now: () => 0,
    ...(usage === undefined ? {} : { usage }),
  });
  return { db, agent: agentA.agent, gateway, knowledgeDir };
}

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  return first !== undefined && first.type === "text" ? first.text : "";
}

function parse(result: CallToolResult): Record<string, unknown> {
  return JSON.parse(textOf(result)) as Record<string, unknown>;
}

const DEADLINE = "2026-12-01T12:00:00Z";

describe("console gateway", () => {
  it("listTools 暴露 11 个裸名控制工具", async () => {
    const { db, gateway } = await setup();
    expect(gateway.listTools().map((tool) => tool.name)).toEqual([
      "task_create",
      "task_update",
      "a2a_send",
      "a2a_inbox",
      "a2a_ack",
      "kb_search",
      "kb_write",
      "work_inbox",
      "work_read",
      "work_ack",
      "work_handback",
      "work_report",
      "work_decide",
    ]);
    await db.close();
  });

  it("task_create 建单并落审计,run_id 与 task_id 均为 null", async () => {
    const { db, agent, gateway } = await setup();
    const result = await gateway.callTool(agent, "task_create", {
      title: "查日志",
      assigner: "console",
      project: "aw",
    });

    expect(result.isError).toBeUndefined();
    const task = parse(result).task as Record<string, unknown>;
    expect(task.assignee).toBe("agt_a");
    expect(await db.get("SELECT run_id, task_id, tool, level, verdict FROM tool_call_log")).toEqual({
      run_id: null,
      task_id: null,
      tool: "task.create",
      level: "L1",
      verdict: "allow",
    });
    await db.close();
  });

  it("task_update 审计带任务归属,任务完成后落 done", async () => {
    const { db, agent, gateway } = await setup();
    const created = parse(
      await gateway.callTool(agent, "task_create", {
        title: "修 Bug",
        assigner: "console",
        project: "aw",
      }),
    ).task as Record<string, unknown>;

    // 状态机先 running 再 done(领域状态机不允许 pending 跃迁 done)
    await gateway.callTool(agent, "task_update", { task_id: created.id, status: "running" });
    const result = await gateway.callTool(agent, "task_update", {
      task_id: created.id,
      status: "done",
    });

    expect(result.isError).toBeUndefined();
    expect((parse(result).task as Record<string, unknown>).status).toBe("done");
    expect(
      await db.get("SELECT task_id, tool, verdict FROM tool_call_log WHERE tool = 'task.update'"),
    ).toEqual({ task_id: created.id, tool: "task.update", verdict: "allow" });
    await db.close();
  });

  it("任务不存在导致审计外键失败,同样拒绝执行", async () => {
    const { db, agent, gateway } = await setup();
    const result = await gateway.callTool(agent, "task_update", {
      task_id: "tsk_missing",
      status: "done",
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("审计写入失败");
    expect(
      await db.get("SELECT COUNT(*) AS n FROM task WHERE id = 'tsk_missing'"),
    ).toEqual({ n: 0 });
    await db.close();
  });

  it("kb_search 审计 L0 allow,task_id 为 null", async () => {
    const { db, agent, gateway } = await setup();
    const result = await gateway.callTool(agent, "kb_search", { search: "部署" });

    expect(result.isError).toBeUndefined();
    expect(parse(result).hits).toEqual([]);
    expect(
      await db.get("SELECT task_id, tool, level, verdict FROM tool_call_log WHERE tool = 'kb.search'"),
    ).toEqual({ task_id: null, tool: "kb.search", level: "L0", verdict: "allow" });
    await db.close();
  });

  it("用量超限时即使 L0 也拒绝,审计 verdict 为 deny", async () => {
    const { db, agent, gateway } = await setup({
      kind: "metered",
      usedTokens: 100,
      dailyLimit: 100,
    });
    const result = await gateway.callTool(agent, "kb_search", { search: "部署" });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("已用尽");
    expect(
      await db.get("SELECT verdict FROM tool_call_log WHERE tool = 'kb.search'"),
    ).toEqual({ verdict: "deny" });
    await db.close();
  });

  it("a2a_send 信封校验失败返回 VALIDATION_FAILED,不落消息", async () => {
    const { db, agent, gateway } = await setup();
    const created = parse(
      await gateway.callTool(agent, "task_create", {
        title: "t",
        assigner: "console",
        project: "aw",
      }),
    ).task as Record<string, unknown>;

    const result = await gateway.callTool(agent, "a2a_send", {
      task_id: created.id,
      to: "agt_b",
      intent: "request",
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("VALIDATION_FAILED");
    expect(await db.get("SELECT COUNT(*) AS n FROM a2a_message")).toEqual({ n: 0 });
    await db.close();
  });

  it("a2a_send 白名单外目标拒绝并附可达目标", async () => {
    const { db, agent, gateway } = await setup();
    const created = parse(
      await gateway.callTool(agent, "task_create", {
        title: "t",
        assigner: "console",
        project: "aw",
      }),
    ).task as Record<string, unknown>;

    const result = await gateway.callTool(agent, "a2a_send", {
      task_id: created.id,
      to: "agt_c",
      intent: "request",
      summary: "帮忙",
      expect: "结论",
      deadline: DEADLINE,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("FORBIDDEN");
    expect(textOf(result)).toContain("可达目标: [agt_b]");
    await db.close();
  });

  it("a2a_send 命中白名单放行并落审计任务归属", async () => {
    const { db, agent, gateway } = await setup();
    const created = parse(
      await gateway.callTool(agent, "task_create", {
        title: "t",
        assigner: "console",
        project: "aw",
      }),
    ).task as Record<string, unknown>;

    const result = await gateway.callTool(agent, "a2a_send", {
      task_id: created.id,
      to: "agt_b",
      intent: "request",
      summary: "帮忙",
      expect: "结论",
      deadline: DEADLINE,
    });

    expect(result.isError).toBeUndefined();
    expect(parse(result).msg_id).toMatch(/^msg_/);
    expect(
      await db.get("SELECT task_id, verdict FROM tool_call_log WHERE tool = 'a2a.send'"),
    ).toEqual({ task_id: created.id, verdict: "allow" });
    await db.close();
  });

  it("kb_write 落 Markdown 与 candidate 镜像,审计带任务归属", async () => {
    const { db, agent, gateway, knowledgeDir } = await setup();
    const created = parse(
      await gateway.callTool(agent, "task_create", {
        title: "t",
        assigner: "console",
        project: "aw",
      }),
    ).task as Record<string, unknown>;

    const result = await gateway.callTool(agent, "kb_write", {
      task_id: created.id,
      path: "notes/deploy.md",
      title: "部署要点",
      summary: "frp 与 compose",
      content: "# 部署\n绑定 127.0.0.1",
    });

    expect(result.isError).toBeUndefined();
    const written = parse(result) as { id: string; path: string };
    expect(written.id).toMatch(/^kb_/);
    expect(readFileSync(join(knowledgeDir, "notes/deploy.md"), "utf8")).toBe("# 部署\n绑定 127.0.0.1");
    expect(
      await db.get(`SELECT status, source_task_id AS "sourceTaskId", source_agent_id AS "sourceAgentId"
                     FROM knowledge_entry WHERE id = '${written.id}'`),
    ).toEqual({ status: "candidate", sourceTaskId: created.id, sourceAgentId: "agt_a" });
    expect(
      await db.get("SELECT task_id FROM tool_call_log WHERE tool = 'kb.write'"),
    ).toEqual({ task_id: created.id });
    await db.close();
  });

  it("未知工具不转发也不落审计", async () => {
    const { db, agent, gateway } = await setup();
    const result = await gateway.callTool(agent, "shell_exec", { cmd: "ls" });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("未知工具");
    expect(await db.get("SELECT COUNT(*) AS n FROM tool_call_log")).toEqual({ n: 0 });
    await db.close();
  });
});
