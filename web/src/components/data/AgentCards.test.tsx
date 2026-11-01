import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OverviewAgent } from "../../api/types.js";
import { AgentCards } from "./AgentCards.js";

function agent(overrides: Partial<OverviewAgent> = {}): OverviewAgent {
  return {
    id: "agt_a",
    displayName: "构建 Agent",
    project: "aw",
    machineId: "m1",
    machineHostname: "build-box",
    machineLastSeenAt: 1_699_999_999_000,
    heartbeat: "ok",
    lastRunAt: null,
    running: false,
    currentTaskId: null,
    currentTaskTitle: null,
    currentTaskStage: null,
    currentTaskStatus: null,
    currentInstruction: null,
    todayTokens: 0,
    ...overrides,
  };
}

describe("Agent 卡片", () => {
  afterEach(() => cleanup());

  it("展示运行任务、心跳状态与今日 Token，运行中的卡片排前", () => {
    render(
      <AgentCards
        agents={[
          agent({ id: "agt_idle", displayName: "空闲 Agent" }),
          agent({
            id: "agt_run",
            displayName: "运行 Agent",
            running: true,
            currentTaskId: "tsk_1",
            currentTaskTitle: "实现接口契约",
            currentTaskStage: "exec",
            currentTaskStatus: "running",
            todayTokens: 1_200_000,
          }),
        ]}
      />,
    );

    const cards = screen.getByRole("list", { name: "Agent 卡片" });
    const items = within(cards).getAllByRole("listitem");
    expect(within(items[0] as HTMLElement).getByText("aw@build-box")).toBeTruthy();
    expect(within(cards).getByText("实现接口契约")).toBeTruthy();
    expect(within(cards).getByText(/执行 · 进行中/)).toBeTruthy();
    expect(within(cards).getByText("1.2M")).toBeTruthy();
    expect(within(cards).getByText("空闲")).toBeTruthy();
    expect(within(cards).getByText("当前没有进行中的任务")).toBeTruthy();
  });

  it("名称统一为 项目@机器名,不再重复展示项目与机器", () => {
    render(
      <AgentCards
        agents={[
          agent({
            displayName: "MacBook cc-sysdev",
            project: "cc-sysdev",
            machineHostname: "MacBook Pro",
            running: true,
          }),
        ]}
      />,
    );

    expect(screen.getByText("cc-sysdev@MacBook Pro")).toBeTruthy();
    expect(screen.queryByText("MacBook cc-sysdev")).toBeNull();
    expect(screen.queryByText("项目 · cc-sysdev")).toBeNull();
    expect(screen.queryByText("MacBook Pro")).toBeNull();
    expect(screen.getByText(/最近运行 ·/)).toBeTruthy();
  });

  it("运行中但无任务归属不显示为空闲", () => {
    render(<AgentCards agents={[agent({ running: true })]} />);

    expect(screen.getByText("运行中 · 当前会话未关联任务")).toBeTruthy();
    expect(screen.queryByText("当前没有进行中的任务")).toBeNull();
  });

  it("运行中无任务归属时展示最近一条指令", () => {
    render(
      <AgentCards
        agents={[agent({ running: true, currentInstruction: "把发件箱重试改成指数退避" })]}
      />,
    );

    expect(screen.getByText("最近指令")).toBeTruthy();
    expect(screen.getByText("· 把发件箱重试改成指数退避")).toBeTruthy();
    expect(screen.queryByText("运行中 · 当前会话未关联任务")).toBeNull();
  });

  it("有任务归属时不展示最近指令", () => {
    render(
      <AgentCards
        agents={[
          agent({
            running: true,
            currentTaskId: "tsk_1",
            currentTaskTitle: "实现接口契约",
            currentInstruction: "把发件箱重试改成指数退避",
          }),
        ]}
      />,
    );

    expect(screen.queryByText("最近指令")).toBeNull();
    expect(screen.getByText("实现接口契约")).toBeTruthy();
  });

  it("心跳超时显示对应状态", () => {
    render(<AgentCards agents={[agent({ heartbeat: "timeout" })]} />);

    expect(screen.getByText("心跳超时")).toBeTruthy();
  });

  it("点击密钥按钮回调对应 Agent", () => {
    const onManageKey = vi.fn();
    render(<AgentCards agents={[agent()]} onManageKey={onManageKey} />);

    fireEvent.click(screen.getByRole("button", { name: "管理 构建 Agent 的密钥" }));
    expect(onManageKey).toHaveBeenCalledWith(expect.objectContaining({ id: "agt_a" }));
  });
});
