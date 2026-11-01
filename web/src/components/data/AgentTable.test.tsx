import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OverviewAgent } from "../../api/types.js";
import { AgentTable } from "./AgentTable.js";

const NOW = 1_700_000_000_000;

function agent(overrides: Partial<OverviewAgent> = {}): OverviewAgent {
  return {
    id: "agt_a",
    displayName: "构建 Agent",
    project: "aw",
    machineId: "m1",
    machineHostname: "build-box",
    machineLastSeenAt: NOW - 1_000,
    heartbeat: "ok",
    lastRunAt: NOW - 30_000,
    running: true,
    currentTaskId: "tsk_1",
    currentTaskTitle: "实现接口契约",
    currentTaskStage: "exec",
    currentTaskStatus: "running",
    todayTokens: 1_234_567,
    ...overrides,
  };
}

describe("Agent 表格", () => {
  afterEach(cleanup);

  it("展示状态双编码、相对时间与缩写 token", () => {
    render(<AgentTable agents={[agent()]} now={NOW} />);

    const table = screen.getByRole("table");
    expect(within(table).getByText("在线")).toBeTruthy();
    expect(within(table).getByText("运行中")).toBeTruthy();
    expect(within(table).getByText("30 秒前")).toBeTruthy();
    expect(within(table).getByText("1.2M")).toBeTruthy();
    expect(within(table).getByTitle("1,234,567")).toBeTruthy();
    expect(within(table).getByText("实现接口契约")).toBeTruthy();
    expect(within(table).getByText("exec · running")).toBeTruthy();
  });

  it("移动端卡片保留 Agent、当前任务与状态", () => {
    render(<AgentTable agents={[agent()]} now={NOW} />);

    const cards = screen.getByRole("list", { name: "Agent 卡片" });
    expect(within(cards).getByText("构建 Agent")).toBeTruthy();
    expect(within(cards).getByText("在线")).toBeTruthy();
    expect(within(cards).getByText("实现接口契约")).toBeTruthy();
  });

  it("心跳超时与未运行单独标注", () => {
    render(
      <AgentTable
        agents={[
          agent({
            id: "agt_b",
            displayName: "空闲 Agent",
            heartbeat: "timeout",
            running: false,
            currentTaskId: null,
            currentTaskTitle: null,
            currentTaskStage: null,
            currentTaskStatus: null,
            lastRunAt: null,
            todayTokens: 0,
          }),
        ]}
        now={NOW}
      />,
    );

    const table = screen.getByRole("table");
    expect(within(table).getByText("心跳超时")).toBeTruthy();
    expect(within(table).getByText("空闲")).toBeTruthy();
    expect(within(table).getByText("从未运行")).toBeTruthy();
    expect(within(table).getByText("—")).toBeTruthy();
  });

  it("提供回调时行内出现密钥入口", () => {
    const onManageKey = vi.fn();
    const agentRow = agent();
    render(<AgentTable agents={[agentRow]} onManageKey={onManageKey} />);

    const table = screen.getByRole("table");
    fireEvent.click(within(table).getByRole("button", { name: "管理 构建 Agent 的密钥" }));
    expect(onManageKey).toHaveBeenCalledWith(agentRow);
  });

  it("无回调时不渲染密钥列", () => {
    render(<AgentTable agents={[agent()]} />);
    expect(screen.queryByRole("button", { name: /密钥/ })).toBeNull();
  });
});
