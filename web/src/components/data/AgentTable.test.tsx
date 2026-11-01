import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

    expect(screen.getByText("在线")).toBeTruthy();
    expect(screen.getByText("运行中")).toBeTruthy();
    expect(screen.getByText("30 秒前")).toBeTruthy();
    expect(screen.getByText("1.2M")).toBeTruthy();
    expect(screen.getByTitle("1,234,567")).toBeTruthy();
    expect(screen.getByText("实现接口契约")).toBeTruthy();
    expect(screen.getByText("exec · running")).toBeTruthy();
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

    expect(screen.getByText("心跳超时")).toBeTruthy();
    expect(screen.getByText("空闲")).toBeTruthy();
    expect(screen.getByText("从未运行")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });
});
