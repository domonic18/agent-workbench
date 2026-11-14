import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleRow } from "../api/types.js";
import { SchedulesPage } from "./SchedulesPage.js";

function row(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: "cron:1",
    project: "invest",
    kind: "cron",
    description: "盘后自选更新",
    cronExpr: "0 19 * * 1-5",
    scheduledAt: null,
    nextRunAt: 1_700_003_600_000,
    lastRunAt: 1_699_900_000_000,
    lastError: null,
    enabled: true,
    timezone: "Asia/Shanghai",
    machineId: "m-ok",
    machineName: "macmini",
    agentId: "a-invest",
    agentName: "投资助手",
    botName: "投资机器人",
    stale: false,
    collectedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function fakeFetch(items: ScheduleRow[]): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items }) }) as Response);
}

function renderPage(items: ScheduleRow[]): void {
  vi.stubGlobal("fetch", fakeFetch(items));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={["/schedules"]}>
      <QueryClientProvider client={client}>
        <SchedulesPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("定时任务屏", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("列出任务、机器人、频率与下次执行", async () => {
    renderPage([row()]);

    expect((await screen.findAllByText("盘后自选更新")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("投资机器人").length).toBeGreaterThan(0);
    expect(screen.getAllByText("工作日 19:00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("macmini").length).toBeGreaterThan(0);
    expect(screen.getByText("计划总数")).toBeTruthy();
  });

  it("项目没登记就如实说没登记", async () => {
    renderPage([
      row({ project: "article", agentId: null, agentName: null, botName: null }),
    ]);

    expect((await screen.findAllByText("未登记 Agent（项目 article）")).length).toBeGreaterThan(0);
  });

  it("状态按机器在线、停用与出错分别标注", async () => {
    renderPage([
      row({ id: "cron:1", description: "任务一" }),
      row({ id: "cron:2", description: "任务二", enabled: false }),
      row({ id: "cron:3", description: "任务三", lastError: '会话 "会话" 正忙' }),
      row({ id: "cron:4", description: "任务四", stale: true }),
    ]);

    await screen.findAllByText("任务一");
    expect(screen.getAllByText("正常").length).toBeGreaterThan(0);
    expect(screen.getAllByText("已停用").length).toBeGreaterThan(0);
    expect(screen.getAllByText("上次出错").length).toBeGreaterThan(0);
    expect(screen.getAllByText("状态未知").length).toBeGreaterThan(0);
  });

  it("一次性任务频率列写明一次性", async () => {
    renderPage([
      row({
        id: "timer:1",
        kind: "timer",
        description: "两小时后复查",
        cronExpr: null,
        scheduledAt: 1_700_003_600_000,
        nextRunAt: 1_700_003_600_000,
        lastRunAt: null,
      }),
    ]);

    expect((await screen.findAllByText("两小时后复查")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("一次性").length).toBeGreaterThan(0);
  });

  it("没有计划时给空态", async () => {
    renderPage([]);

    expect(await screen.findByText("还没有定时任务")).toBeTruthy();
  });

  it("页脚交代只读边界与可见性口径", async () => {
    renderPage([row()]);

    await screen.findAllByText("盘后自选更新");
    await waitFor(() => {
      expect(screen.getByText(/只读视图/)).toBeTruthy();
    });
    expect(screen.getByText(/未纳管机器/)).toBeTruthy();
  });
});
