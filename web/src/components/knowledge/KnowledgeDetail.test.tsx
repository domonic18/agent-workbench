import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeEntryDto } from "../../api/knowledge.js";
import {
  adoptKnowledgeEntry,
  archiveKnowledgeEntry,
  fetchKnowledgeEntry,
  updateKnowledgeEntry,
} from "../../api/knowledge.js";
import { KnowledgeDetail } from "./KnowledgeDetail.js";

vi.mock("../../api/knowledge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/knowledge.js")>();
  return {
    ...actual,
    fetchKnowledgeEntry: vi.fn(),
    updateKnowledgeEntry: vi.fn(),
    adoptKnowledgeEntry: vi.fn(),
    archiveKnowledgeEntry: vi.fn(),
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
    sourceTaskId: "tsk_1",
    sourceAgentId: "agent:codex",
    embeddingStatus: "ready",
    protected: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const CONTENT = "# 部署说明\n\n- 先 **备份**\n- 再发布\n";

function renderDetail(target: KnowledgeEntryDto, content = CONTENT): void {
  vi.mocked(fetchKnowledgeEntry).mockResolvedValue({ entry: target, content });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <KnowledgeDetail entryId={target.id} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("知识详情抽屉", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("渲染 Markdown 正文与元信息", async () => {
    renderDetail(entry());

    expect(await screen.findByRole("heading", { name: "部署说明" })).toBeTruthy();
    expect(screen.getByText("备份").tagName).toBe("STRONG");
    expect(screen.getByText("notes/deploy.md")).toBeTruthy();
    expect(screen.getByText("tsk_1")).toBeTruthy();
  });

  it("受保护文件只读,不提供编辑入口", async () => {
    renderDetail(entry({ path: "index.md", protected: true }));

    expect(await screen.findByText("index.md / log.md 由系统维护，控制台只读。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
  });

  it("编辑后保存写入标题与 Markdown 正文", async () => {
    vi.mocked(updateKnowledgeEntry).mockResolvedValue({ entry: entry({ title: "新标题" }) });
    renderDetail(entry());

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "新标题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateKnowledgeEntry).toHaveBeenCalledWith("kb_1", {
        content: CONTENT,
        title: "新标题",
        summary: "发布前先备份",
        category: "ops",
      }),
    );
  });

  it("候选可单条采纳", async () => {
    vi.mocked(adoptKnowledgeEntry).mockResolvedValue({ entry: entry({ status: "active" }) });
    renderDetail(entry({ status: "candidate" }));

    fireEvent.click(await screen.findByRole("button", { name: "采纳" }));

    await waitFor(() => expect(adoptKnowledgeEntry).toHaveBeenCalledWith("kb_1"));
  });

  it("候选丢弃需二次确认", async () => {
    vi.mocked(archiveKnowledgeEntry).mockResolvedValue({
      entry: entry({ status: "archived" }),
    });
    renderDetail(entry({ status: "candidate" }));

    fireEvent.click(await screen.findByRole("button", { name: "丢弃" }));
    expect(archiveKnowledgeEntry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认丢弃" }));
    await waitFor(() => expect(archiveKnowledgeEntry).toHaveBeenCalledWith("kb_1"));
  });
});
