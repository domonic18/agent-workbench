import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskDto } from "../../api/tasks.js";
import { TaskTable } from "./TaskTable.js";

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "tsk_1",
    title: "实现任务屏",
    assigner: "feishu:alice",
    assignee: "agt_a",
    assigner_label: "feishu:alice",
    assignee_label: "agt_a",
    project: "aw",
    parent_task_id: null,
    round: 1,
    rework_count: 0,
    stage: "exec",
    status: "running",
    origin: "a2a",
    deadline_at: null,
    output: null,
    started_at: 1_700_000_000_000,
    ended_at: null,
    total_tokens: 1_200_000,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    ...overrides,
  };
}

function renderTable(tasks: TaskDto[], agentNames = new Map<string, string>()): void {
  render(
    <MemoryRouter initialEntries={["/tasks?status=blocked"]}>
      <TaskTable
        tasks={tasks}
        agentNames={agentNames}
        search="?status=blocked"
        now={1_700_000_090_000}
      />
    </MemoryRouter>,
  );
}

describe("任务表格", () => {
  afterEach(() => cleanup());

  it("行内展示承接人、阶段、返工与耗时,链接保留筛选", () => {
    renderTable(
      [task({ rework_count: 2, ended_at: 1_700_000_060_000 })],
      new Map([["agt_a", "构建 Agent"]]),
    );

    const table = screen.getByRole("table");
    const link = within(table).getByRole("link", { name: "实现任务屏" });
    expect(link.getAttribute("href")).toBe("/tasks/tsk_1?status=blocked");
    expect(within(table).getByText("构建 Agent")).toBeTruthy();
    expect(within(table).getByText("agt_a")).toBeTruthy();
    expect(within(table).getByText("执行")).toBeTruthy();
    expect(within(table).getByText("返工 2 次")).toBeTruthy();
    expect(within(table).getByText("1m")).toBeTruthy();
    expect(within(table).getByText("1.2M")).toBeTruthy();
    expect(within(table).getByText("A2A")).toBeTruthy();
  });

  it("移动端卡片保留任务、承接与状态三列", () => {
    renderTable([task()], new Map([["agt_a", "构建 Agent"]]));

    const cards = screen.getByRole("list", { name: "任务卡片" });
    const link = within(cards).getByRole("link", { name: "实现任务屏" });
    expect(link.getAttribute("href")).toBe("/tasks/tsk_1?status=blocked");
    expect(within(cards).getByText("构建 Agent")).toBeTruthy();
    expect(within(cards).getByText("进行中")).toBeTruthy();
  });

  it("HTTP 产出渲染为外链,其余按代码展示,缺失给占位", () => {
    renderTable([
      task({ id: "tsk_http", title: "外链任务", output: "https://example.com/report" }),
      task({ id: "tsk_kb", title: "知识任务", output: "kb_abc123" }),
      task({ id: "tsk_none", title: "无产出任务", output: null }),
    ]);

    const table = screen.getByRole("table");
    const anchor = within(table).getByRole("link", { name: "https://example.com/report" });
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(within(table).getByTitle("kb_abc123").textContent).toBe("kb_abc123");
    expect(within(table).getByText("—")).toBeTruthy();
  });
});
