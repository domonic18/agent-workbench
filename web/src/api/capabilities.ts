import type { CapabilityAction } from "@shared/constants.js";
import { api, newIdempotencyKey } from "./client.js";
import type { CapabilityStatus } from "./tasks.js";

/** 授权屏三视图(03 §4.3);issuing 归「待批」,避免签发中掉出视野 */
export const CAPABILITY_VIEWS = ["pending", "active", "history"] as const;
export type CapabilityView = (typeof CAPABILITY_VIEWS)[number];

export const CAPABILITY_VIEW_LABEL: Record<CapabilityView, string> = {
  pending: "待批",
  active: "生效",
  history: "历史",
};

export interface CapabilityDto {
  id: string;
  subject: string;
  target: string;
  action: CapabilityAction;
  scope: unknown;
  ttlSeconds: number;
  status: CapabilityStatus;
  ticketId: string | null;
  taskId: string;
  issuedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CapabilityListResponse {
  items: CapabilityDto[];
  nextCursor: string | null;
}

export interface CapabilityCreateInput {
  subject: string;
  target: string;
  action: CapabilityAction;
  scope: unknown;
  ttlSeconds: number;
  taskId: string;
}

export interface CapabilityDecisionResponse {
  applied: boolean;
  capability: CapabilityDto;
}

export function readCapabilityView(params: URLSearchParams): CapabilityView {
  const raw = params.get("view");
  return raw !== null && (CAPABILITY_VIEWS as readonly string[]).includes(raw)
    ? (raw as CapabilityView)
    : "pending";
}

export function fetchCapabilities(
  view: CapabilityView,
  cursor?: string,
): Promise<CapabilityListResponse> {
  const params = new URLSearchParams({ view });
  if (cursor !== undefined) {
    params.set("cursor", cursor);
  }
  return api.get<CapabilityListResponse>(`/api/capabilities?${params.toString()}`);
}

/** 签发失败后的重试 = 用原参数重新申请一条 pending(旧记录 rejected 无出边) */
export function createCapability(
  input: CapabilityCreateInput,
): Promise<{ capability: CapabilityDto }> {
  return api.post<{ capability: CapabilityDto }>("/api/capabilities", input, {
    idempotencyKey: newIdempotencyKey(),
  });
}

export function approveCapability(id: string): Promise<CapabilityDecisionResponse> {
  return api.post<CapabilityDecisionResponse>(
    `/api/capabilities/${encodeURIComponent(id)}/approve`,
    undefined,
    { idempotencyKey: newIdempotencyKey() },
  );
}

export function rejectCapability(
  id: string,
  reason?: string,
): Promise<CapabilityDecisionResponse> {
  return api.post<CapabilityDecisionResponse>(
    `/api/capabilities/${encodeURIComponent(id)}/reject`,
    reason === undefined ? undefined : { reason },
    { idempotencyKey: newIdempotencyKey() },
  );
}

export function revokeCapability(
  id: string,
  reason?: string,
): Promise<CapabilityDecisionResponse> {
  return api.post<CapabilityDecisionResponse>(
    `/api/capabilities/${encodeURIComponent(id)}/revoke`,
    reason === undefined ? undefined : { reason },
    { idempotencyKey: newIdempotencyKey() },
  );
}
