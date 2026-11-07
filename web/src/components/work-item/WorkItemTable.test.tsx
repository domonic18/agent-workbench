import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkItemListItem } from "../../api/work-items.js";
import { WorkItemTable } from "./WorkItemTable.js";

function item(overrides: Partial<WorkItemListItem> = {}): WorkItemListItem {
  return {
    id: "wim_1",
    project: "aw",
    kind: "bug_fix",
    title: "修复登录跳转",
    status: "open",
    stage: "execute",
    attention: "person",
    nextAction: "等待人工确认补丁",
    latestSummary: "补丁已提交",
    lastProgressAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location">
      {location.pathname}
      {location.search}
      {location.state === null ? "" : JSON.stringify(location.state)}
    </span>
  );
}

function renderTable(items: WorkItemListItem[], search = "?wi=person"): void {
  render(
    <MemoryRouter initialEntries={["/overview"]}>
      <WorkItemTable items={items} from={`/overview${search}`} search={search} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("工作事项表格", () => {
  afterEach(() => {
    cleanup();
  });

  it("渲染列内容与注意力标签", () => {
    renderTable([item()]);

    expect(screen.getAllByText("修复登录跳转").length).toBeGreaterThan(0);
    expect(screen.getAllByText("aw").length).toBeGreaterThan(0);
    expect(screen.getAllByText("执行").length).toBeGreaterThan(0);
    expect(screen.getAllByText("需要人").length).toBeGreaterThan(0);
    expect(screen.getAllByText("等待人工确认补丁").length).toBeGreaterThan(0);
  });

  it("没有下一步时明说尚未给出", () => {
    renderTable([item({ nextAction: null })]);

    expect(screen.getAllByText("尚未给出下一步").length).toBeGreaterThan(0);
  });

  it("点行进详情并带上返回路径", async () => {
    renderTable([item()]);

    const row = screen.getByRole("row", { name: /修复登录跳转/ });
    fireEvent.click(within(row).getByText("aw"));

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toContain("/work-items/wim_1?wi=person");
    });
    expect(screen.getByTestId("location").textContent).toContain("/overview?wi=person");
  });
});
