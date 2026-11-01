import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchKnowledge, type KnowledgeEntryDto } from "../api/knowledge.js";
import { KnowledgePage } from "./KnowledgePage.js";

vi.mock("../api/knowledge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/knowledge.js")>();
  return {
    ...actual,
    fetchKnowledge: vi.fn(),
    adoptKnowledgeEntry: vi.fn(),
    archiveKnowledgeEntry: vi.fn(),
    reindexKnowledgeEntry: vi.fn(),
  };
});

const NOW = 1_700_000_000_000;

function entry(overrides: Partial<KnowledgeEntryDto> = {}): KnowledgeEntryDto {
  return {
    id: "kb_1",
    path: "notes/deploy.md",
    title: "部署约定",
    summary: "发布前先备份",
    category: "ops",
    status: "active",
    sourceTaskId: null,
    sourceAgentId: null,
    embeddingStatus: "ready",
    protected: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function emptyCounts(candidate = 0) {
  return { draft: 0, candidate, active: 0, archived: 0 };
}

function renderPage(entryPath: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entryPath]}>
        <Routes>
          <Route path="/knowledge" element={<KnowledgePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("知识屏", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("默认列出已生效条目并高亮页签", async () => {
    vi.mocked(fetchKnowledge).mockResolvedValue({
      items: [entry()],
      counts: { draft: 0, candidate: 0, active: 1, archived: 0 },
      nextCursor: null,
    });
    renderPage("/knowledge");

    expect((await screen.findAllByText("部署约定")).length).toBeGreaterThan(0);
    expect(fetchKnowledge).toHaveBeenCalledWith("active", {});
    expect(
      screen.getByRole("link", { name: "已生效" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("待采纳页签带数量角标,并逐条给出采纳按钮", async () => {
    vi.mocked(fetchKnowledge).mockResolvedValue({
      items: [entry({ id: "kb_2", status: "candidate", title: "候选条目" })],
      counts: emptyCounts(3),
      nextCursor: null,
    });
    renderPage("/knowledge?view=candidate");

    expect((await screen.findAllByText("候选条目")).length).toBeGreaterThan(0);
    expect(fetchKnowledge).toHaveBeenCalledWith("candidate", {});
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "采纳" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("切换页签改写 URL 并换取对应视图", async () => {
    vi.mocked(fetchKnowledge).mockResolvedValue({
      items: [],
      counts: emptyCounts(),
      nextCursor: null,
    });
    renderPage("/knowledge");

    fireEvent.click(screen.getByRole("link", { name: "已归档" }));

    await waitFor(() => expect(fetchKnowledge).toHaveBeenCalledWith("archived", {}));
    expect(await screen.findByText("没有已归档条目")).toBeTruthy();
  });

  it("搜索写入 q 参数并带进请求", async () => {
    vi.mocked(fetchKnowledge).mockResolvedValue({
      items: [],
      counts: emptyCounts(),
      nextCursor: null,
    });
    renderPage("/knowledge?view=candidate");

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索知识" }), {
      target: { value: "部署" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() =>
      expect(fetchKnowledge).toHaveBeenCalledWith("candidate", { search: "部署" }),
    );
    expect(await screen.findByText("没有匹配的知识")).toBeTruthy();
  });

  it("空态按视图给出提示", async () => {
    vi.mocked(fetchKnowledge).mockResolvedValue({
      items: [],
      counts: emptyCounts(),
      nextCursor: null,
    });
    renderPage("/knowledge");

    expect(await screen.findByText("知识库还没有生效条目")).toBeTruthy();
  });
});
