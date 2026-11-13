import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRosterSummary } from "../../../api/identity.js";
import type { OverviewAgent } from "../../../api/types.js";
import { AgentOfficeScene } from "./AgentOfficeScene.js";

function agent(overrides: Partial<AgentRosterSummary> = {}): AgentRosterSummary {
  return {
    id: "agt_a",
    machineId: "m1",
    runtime: "claude_code",
    project: "aw",
    displayName: "构建 Agent",
    feishuAppId: null,
    feishuBotName: null,
    status: "active",
    allowedTargets: [],
    createdAt: 0,
    updatedAt: 0,
    key: null,
    usageLimit: null,
    machineHostname: "build-box",
    machineDisplayName: null,
    totalRuns: 0,
    totalTokens: 0,
    openTasks: 0,
    lastRunAt: null,
    ...overrides,
  };
}

function live(overrides: Partial<OverviewAgent> = {}): OverviewAgent {
  return {
    id: "agt_a",
    displayName: "构建 Agent",
    feishuBotName: null,
    project: "aw",
    machineId: "m1",
    runtime: "claude_code",
    machineHostname: "build-box",
    machineDisplayName: null,
    machineLastSeenAt: 0,
    heartbeat: "ok",
    activeSessions: null,
    lastRunAt: null,
    lastRunEndedAt: null,
    running: false,
    currentTaskId: null,
    currentTaskTitle: null,
    currentTaskStage: null,
    currentTaskStatus: null,
    currentInstruction: null,
    dispatchHold: null,
    dispatchPending: null,
    dispatchHoldSince: null,
    todayTokens: 0,
    ...overrides,
  };
}

function liveById(items: OverviewAgent[]): Map<string, OverviewAgent> {
  return new Map(items.map((item) => [item.id, item]));
}

function renderScene(
  agents: AgentRosterSummary[],
  lives: OverviewAgent[],
  onOpenDetail = vi.fn(),
): void {
  render(
    <AgentOfficeScene agents={agents} liveById={liveById(lives)} onOpenDetail={onOpenDetail} />,
  );
}

describe("办公室视图", () => {
  afterEach(cleanup);

  it("渲染工位按钮，aria-label 带名字、状态与在忙内容", () => {
    renderScene(
      [
        agent(),
        agent({ id: "agt_b", displayName: "测试 Agent" }),
        agent({ id: "agt_c", displayName: "挂起 Agent", status: "active" }),
      ],
      [
        live({
          running: true,
          currentTaskTitle: "实现接口契约",
          todayTokens: 1200,
        }),
        live({ id: "agt_b", displayName: "测试 Agent" }),
        live({ id: "agt_c", displayName: "挂起 Agent", dispatchHold: "cwd_missing" }),
      ],
    );

    expect(
      screen.getByRole("button", { name: "构建 Agent，工作中，实现接口契约" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "测试 Agent，待命，无进行中任务" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "挂起 Agent，派发挂起，无进行中任务" }),
    ).toBeTruthy();
    expect(screen.getByText("今日 1,200 tok")).toBeTruthy();
  });

  it("点击工位打开机器人详情", () => {
    const onOpenDetail = vi.fn();
    renderScene([agent()], [live()], onOpenDetail);

    fireEvent.click(screen.getByRole("button", { name: /构建 Agent/ }));

    expect(onOpenDetail).toHaveBeenCalledTimes(1);
    expect(onOpenDetail.mock.calls[0]?.[0]).toMatchObject({ id: "agt_a" });
  });

  it("按机器分区，区标签带工位数", () => {
    renderScene(
      [
        agent(),
        agent({ id: "agt_b", displayName: "测试 Agent" }),
        agent({ id: "agt_c", displayName: "外部 Agent", machineId: null, machineHostname: null }),
      ],
      [],
    );

    expect(screen.getByText("build-box · 2 个工位")).toBeTruthy();
    expect(screen.getByText("未绑定机器 · 1 个工位")).toBeTruthy();
  });

  it("离线与停用走黯淡姿势，图例给出全部状态", () => {
    renderScene(
      [
        agent({ id: "agt_off", displayName: "离线 Agent", machineId: null }),
        agent({ id: "agt_dis", displayName: "停用 Agent", machineId: null, status: "disabled" }),
      ],
      [live({ id: "agt_off", displayName: "离线 Agent", heartbeat: "timeout", machineId: null })],
    );

    expect(screen.getByRole("button", { name: "离线 Agent，离线，无进行中任务" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "停用 Agent，已停用，无进行中任务" })).toBeTruthy();

    const legend = screen.getByRole("list", { name: "状态图例" });
    for (const label of ["工作中", "待命", "派发挂起", "离线", "已停用"]) {
      expect(legend.textContent).toContain(label);
    }
  });

  it("工作中头顶挂气泡，说的是当前阶段", () => {
    renderScene([agent()], [live({ running: true, currentTaskStage: "exec" })]);

    expect(screen.getByText("执行")).toBeTruthy();
  });

  it("刚跑完的待命 Agent 说刚刚完成，离线的 Agent 头顶打盹", () => {
    renderScene(
      [agent(), agent({ id: "agt_off", displayName: "离线 Agent", machineId: null })],
      [
        live({ lastRunEndedAt: Date.now() - 30_000 }),
        live({ id: "agt_off", displayName: "离线 Agent", heartbeat: "timeout", machineId: null }),
      ],
    );

    expect(screen.getByText("刚刚完成")).toBeTruthy();
    expect(screen.getByText("Z")).toBeTruthy();
  });

  it("状态从待命变成工作时播一次过渡动作", () => {
    const { rerender } = render(
      <AgentOfficeScene agents={[agent()]} liveById={liveById([live()])} onOpenDetail={vi.fn()} />,
    );
    expect(document.querySelector('[style*="clip-sit-down-back"]')).toBeNull();

    rerender(
      <AgentOfficeScene
        agents={[agent()]}
        liveById={liveById([live({ running: true })])}
        onOpenDetail={vi.fn()}
      />,
    );

    expect(document.querySelector('[style*="clip-sit-down-back"]')).toBeTruthy();
  });

  it("工位上摆着桌面小物", () => {
    renderScene([agent()], [live()]);

    const prop = document.querySelector('img[src="/pix/props/plant.webp"]');
    expect(prop).toBeTruthy();
  });
});
