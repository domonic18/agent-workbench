import { api, newIdempotencyKey } from "./client.js";
import type { AgentGroupSummary } from "./types.js";

interface GroupListResponse {
  items: AgentGroupSummary[];
}

/** 委派目标组列表 */
export function fetchAgentGroups(): Promise<AgentGroupSummary[]> {
  return api.get<GroupListResponse>("/api/agent-groups").then((response) => response.items);
}

export function createAgentGroup(input: {
  name: string;
  memberIds?: string[];
}): Promise<{ group: AgentGroupSummary }> {
  return api.post<{ group: AgentGroupSummary }>("/api/agent-groups", input, {
    idempotencyKey: newIdempotencyKey(),
  });
}

export function updateAgentGroup(
  id: string,
  input: { name?: string; memberIds?: string[] },
): Promise<{ group: AgentGroupSummary }> {
  return api.put<{ group: AgentGroupSummary }>(
    `/api/agent-groups/${encodeURIComponent(id)}`,
    input,
    { idempotencyKey: newIdempotencyKey() },
  );
}

export function deleteAgentGroup(id: string): Promise<{ removed: boolean }> {
  return api.delete<{ removed: boolean }>(`/api/agent-groups/${encodeURIComponent(id)}`, undefined, {
    idempotencyKey: newIdempotencyKey(),
  });
}
