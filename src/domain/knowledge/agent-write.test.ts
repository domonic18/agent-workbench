import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertTask } from "../../store/repositories/task.js";
import { insertAgent, insertMachine } from "../../store/repositories/identity.js";
import { findKnowledgeEntryByPath } from "../../store/repositories/knowledge.js";
import { KnowledgeError } from "./entry-service.js";
import { writeKnowledgeCandidate } from "./agent-write.js";

const NOW = 1_700_000_000_000;

describe("writeKnowledgeCandidate", () => {
  let db: Db;
  let dir: string;

  beforeEach(async () => {
    db = await openDatabase();
    dir = mkdtempSync(join(tmpdir(), "aw-kb-write-"));
    await insertMachine(db, {
      id: "m1",
      hostname: "h",
      os: "linux",
      collectorVersion: "1",
      collectorSecretHash: "hash",
      createdAt: NOW,
    });
    for (const [id, project] of [
      ["agt_a", "aw"],
      ["agt_b", "pb"],
    ] as const) {
      await insertAgent(db, {
        id,
        machineId: "m1",
        runtime: "claude_code",
        project,
        displayName: id,
        secretHash: "hash",
        feishuAppId: null,
        allowedTargetsJson: "[]",
        createdAt: NOW,
      });
    }
    await insertTask(db, {
      id: "tsk_a",
      title: "上游任务",
      assigner: "human",
      assignee: "agt_a",
      project: "aw",
      parentTaskId: null,
      origin: "a2a",
      deadlineAt: null,
      output: null,
      createdAt: NOW,
    });
  });

  afterEach(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("写 Markdown 文件并落 candidate 镜像,来源挂任务与 Agent", async () => {
    const { id, path } = await writeKnowledgeCandidate(
      { id: "agt_a" },
      {
        taskId: "tsk_a",
        path: "notes/bug-fix.md",
        title: "采集器缓冲修复记录",
        summary: "inode 轮转处理",
        category: "ops",
        content: "# 修复记录\n\n发件箱重试导致缓冲重复推送。",
      },
      { db, knowledgeDir: dir, now: () => NOW },
    );

    expect(id).toMatch(/^kb_/);
    expect(readFileSync(join(dir, "notes/bug-fix.md"), "utf8")).toContain("缓冲重复推送");
    const entry = await findKnowledgeEntryByPath(db, path);
    expect(entry).toMatchObject({
      id,
      status: "candidate",
      sourceTaskId: "tsk_a",
      sourceAgentId: "agt_a",
      title: "采集器缓冲修复记录",
    });
  });

  it("任务不属于本 Agent 时拒绝", async () => {
    await expect(
      writeKnowledgeCandidate(
        { id: "agt_b" },
        { taskId: "tsk_a", path: "notes/x.md", title: "T", content: "c" },
        { db, knowledgeDir: dir, now: () => NOW },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("受保护文件与已存在路径拒绝", async () => {
    await expect(
      writeKnowledgeCandidate(
        { id: "agt_a" },
        { taskId: "tsk_a", path: "index.md", title: "T", content: "c" },
        { db, knowledgeDir: dir, now: () => NOW },
      ),
    ).rejects.toBeInstanceOf(KnowledgeError);

    await writeKnowledgeCandidate(
      { id: "agt_a" },
      { taskId: "tsk_a", path: "notes/dup.md", title: "T", content: "c" },
      { db, knowledgeDir: dir, now: () => NOW },
    );
    await expect(
      writeKnowledgeCandidate(
        { id: "agt_a" },
        { taskId: "tsk_a", path: "notes/dup.md", title: "T2", content: "c2" },
        { db, knowledgeDir: dir, now: () => NOW },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("越界路径拒绝,不落文件", async () => {
    mkdirSync(join(dir, "outside"), { recursive: true });
    await expect(
      writeKnowledgeCandidate(
        { id: "agt_a" },
        { taskId: "tsk_a", path: "../outside/evil.md", title: "T", content: "c" },
        { db, knowledgeDir: dir, now: () => NOW },
      ),
    ).rejects.toThrow(/越出知识目录/);
  });
});
