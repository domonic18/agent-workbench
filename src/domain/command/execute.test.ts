import { describe, expect, it } from "vitest";
import type { TaskSummary } from "../../store/repositories/task.js";
import { executeCommand, type CommandDeps } from "./execute.js";

function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: "T-1",
    title: "整理采集器缓冲区",
    assigner: "agent-a",
    assignee: "agent-b",
    project: "aw",
    stage: "exec",
    status: "running",
    deadlineAt: 1_700_000_000_000,
    totalTokens: 1234,
    ...overrides,
  };
}

function deps(tasks: TaskSummary[] = []): CommandDeps {
  return {
    listTasks: (limit) => tasks.slice(0, limit),
    findTask: (id) => tasks.find((item) => item.id === id),
  };
}

describe("executeCommand", () => {
  it("空库查询如实回执,不编造任务", () => {
    expect(executeCommand(deps(), "/task list")).toEqual({
      outcome: "handled",
      command: "task.list",
      reply: "当前没有任务。",
    });
  });

  it("列表按传入顺序输出摘要", () => {
    const result = executeCommand(deps([task(), task({ id: "T-2", title: "补迁移" })]), "/task list");
    expect(result.outcome).toBe("handled");
    expect(result.reply).toContain("任务 2 条");
    expect(result.reply).toContain("T-1 · 整理采集器缓冲区 · exec/running");
    expect(result.reply).toContain("T-2 · 补迁移");
  });

  it("单任务查询给出完整字段,不存在时明确未找到", () => {
    const found = executeCommand(deps([task()]), "/task T-1");
    expect(found.reply).toContain("阶段 / 状态：exec / running");
    expect(found.reply).toContain("下发 → 承接：agent-a → agent-b");
    expect(found.reply).toContain("token：1234");

    expect(executeCommand(deps([task()]), "/task T-9")).toEqual({
      outcome: "handled",
      command: "task.show",
      reply: "未找到任务 T-9。",
    });
  });

  it("审批与重发只记录并如实说明尚未接入,不产生任务", () => {
    const approve = executeCommand(deps([task()]), "/approve T-1");
    expect(approve.command).toBe("approve");
    expect(approve.reply).toContain("审批通道尚未接入");
    expect(approve.reply).toContain("exec/running");

    const reject = executeCommand(deps([task()]), "/reject T-1 磁盘已满");
    expect(reject.reply).toContain("原因：磁盘已满");

    const resend = executeCommand(deps([task()]), "/resend T-1");
    expect(resend.reply).toContain("通知重发尚未接入");

    expect(executeCommand(deps([task()]), "/approve T-9").reply).toBe("未找到任务 T-9。");
  });

  it("不支持与缺参回执说明原因与可用命令", () => {
    const unsupported = executeCommand(deps(), "帮我建个任务");
    expect(unsupported.outcome).toBe("unsupported");
    expect(unsupported.command).toBeNull();
    expect(unsupported.reply).toContain("不支持该指令");
    expect(unsupported.reply).toContain("/task list");

    const missing = executeCommand(deps(), "/approve");
    expect(missing.outcome).toBe("invalid");
    expect(missing.reply).toContain("缺少参数：taskId");
  });

  it("列表最多 10 条,防止回执刷屏", () => {
    const tasks = Array.from({ length: 12 }, (_, index) =>
      task({ id: `T-${String(index + 1)}`, title: `任务 ${String(index + 1)}` }),
    );
    const reply = executeCommand(deps(tasks), "/task list").reply;
    expect(reply).toContain("任务 10 条（仅显示最近 10 条）");
    expect(reply).not.toContain("T-11");
  });
});
