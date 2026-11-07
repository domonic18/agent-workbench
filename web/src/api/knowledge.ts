import { api, newIdempotencyKey } from "./client.js";
import {
  KNOWLEDGE_EMBEDDING_STATUSES,
  KNOWLEDGE_LIMITS,
  KNOWLEDGE_STATUSES,
} from "@shared/constants.js";
import type {
  KnowledgeEmbeddingStatus,
  KnowledgeStatus,
} from "@shared/constants.js";

export { KNOWLEDGE_EMBEDDING_STATUSES, KNOWLEDGE_LIMITS, KNOWLEDGE_STATUSES };
export type { KnowledgeEmbeddingStatus, KnowledgeStatus };

/** 知识屏页签(03 §4.4):默认 active;候选与归档各自成页,不做全选批量采纳 */
export const KNOWLEDGE_VIEWS = ["active", "candidate", "archived"] as const;
export type KnowledgeView = (typeof KNOWLEDGE_VIEWS)[number];

export const KNOWLEDGE_VIEW_LABEL: Record<KnowledgeView, string> = {
  active: "已生效",
  candidate: "待采纳",
  archived: "已归档",
};

export interface KnowledgeEntryDto {
  id: string;
  path: string;
  title: string;
  summary: string;
  category: string;
  status: KnowledgeStatus;
  sourceTaskId: string | null;
  sourceAgentId: string | null;
  embeddingStatus: KnowledgeEmbeddingStatus;
  protected: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeCounts {
  draft: number;
  candidate: number;
  active: number;
  archived: number;
}

export interface KnowledgeListResponse {
  items: KnowledgeEntryDto[];
  counts: KnowledgeCounts;
  nextCursor: string | null;
}

export interface KnowledgeDetailResponse {
  entry: KnowledgeEntryDto;
  content: string;
}

export interface KnowledgeUpdateInput {
  content: string;
  title?: string;
  summary?: string;
  category?: string;
}

export function readKnowledgeView(params: URLSearchParams): KnowledgeView {
  const raw = params.get("view");
  return raw !== null && (KNOWLEDGE_VIEWS as readonly string[]).includes(raw)
    ? (raw as KnowledgeView)
    : "active";
}

export function readKnowledgeSearch(params: URLSearchParams): string {
  return params.get("q")?.trim() ?? "";
}

export function fetchKnowledge(
  view: KnowledgeView,
  options: { search?: string; cursor?: string } = {},
): Promise<KnowledgeListResponse> {
  const params = new URLSearchParams({ status: view });
  if (options.search !== undefined && options.search !== "") {
    params.set("q", options.search);
  }
  if (options.cursor !== undefined) {
    params.set("cursor", options.cursor);
  }
  return api.get<KnowledgeListResponse>(`/api/knowledge?${params.toString()}`);
}

export function fetchKnowledgeEntry(id: string): Promise<KnowledgeDetailResponse> {
  return api.get<KnowledgeDetailResponse>(`/api/knowledge/${encodeURIComponent(id)}`);
}

export function updateKnowledgeEntry(
  id: string,
  input: KnowledgeUpdateInput,
): Promise<{ entry: KnowledgeEntryDto }> {
  return api.put<{ entry: KnowledgeEntryDto }>(
    `/api/knowledge/${encodeURIComponent(id)}`,
    input,
    { idempotencyKey: newIdempotencyKey() },
  );
}

export function adoptKnowledgeEntry(id: string): Promise<{ entry: KnowledgeEntryDto }> {
  return api.post<{ entry: KnowledgeEntryDto }>(
    `/api/knowledge/${encodeURIComponent(id)}/adopt`,
    undefined,
    { idempotencyKey: newIdempotencyKey() },
  );
}

export function archiveKnowledgeEntry(id: string): Promise<{ entry: KnowledgeEntryDto }> {
  return api.post<{ entry: KnowledgeEntryDto }>(
    `/api/knowledge/${encodeURIComponent(id)}/archive`,
    undefined,
    { idempotencyKey: newIdempotencyKey() },
  );
}

export function reindexKnowledgeEntry(id: string): Promise<{ outcome: string }> {
  return api.post<{ outcome: string }>(
    `/api/knowledge/entries/${encodeURIComponent(id)}/reindex`,
    undefined,
    { idempotencyKey: newIdempotencyKey() },
  );
}
