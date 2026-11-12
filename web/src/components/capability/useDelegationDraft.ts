import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ApiError } from "../../api/client.js";
import { fetchAgents, setAgentTargets, type AgentSummary } from "../../api/identity.js";

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const seen = new Set(a);
  return b.every((id) => seen.has(id));
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export type DelegationSelection = Record<string, string[]>;

export interface DelegationDraft {
  agents: AgentSummary[];
  isPending: boolean;
  isError: boolean;
  /** Agent 名册查询失败原因(与保存失败 error 分开) */
  queryError: unknown;
  refetch: () => Promise<unknown>;
  /** 当前勾选态:草稿优先,无草稿即已保存态 */
  selection: DelegationSelection;
  /** 与已保存态不一致的发起方 */
  dirty: AgentSummary[];
  pending: boolean;
  /** 保存失败信息;null 表示无 */
  error: string | null;
  toggle: (initiator: AgentSummary, recipient: AgentSummary) => void;
  save: () => Promise<void>;
}

/**
 * 委派白名单的草稿态:图与表两种视图共用,
 * 保存语义恒为「只 PUT 变更过的发起方行」。
 */
export function useDelegationDraft(): DelegationDraft {
  const queryClient = useQueryClient();
  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });
  const [draft, setDraft] = useState<DelegationSelection | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const saved = useMemo(() => {
    const map: DelegationSelection = {};
    for (const agent of agents) {
      map[agent.id] = [...agent.allowedTargets];
    }
    return map;
  }, [agents]);
  const selection = draft ?? saved;
  const dirty = agents.filter((agent) => !sameSet(selection[agent.id] ?? [], saved[agent.id] ?? []));

  function toggle(initiator: AgentSummary, recipient: AgentSummary): void {
    const current = selection[initiator.id] ?? [];
    const next = current.includes(recipient.id)
      ? current.filter((id) => id !== recipient.id)
      : [...current, recipient.id];
    setDraft({ ...selection, [initiator.id]: next });
    setError(null);
  }

  async function save(): Promise<void> {
    if (dirty.length === 0) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await Promise.all(
        dirty.map((agent) => setAgentTargets(agent.id, selection[agent.id] ?? [])),
      );
      await queryClient.invalidateQueries({ queryKey: ["agents"], exact: true });
      setDraft(null);
    } catch (caught) {
      setError(messageOf(caught, "保存失败，请稍后再试"));
    } finally {
      setPending(false);
    }
  }

  return {
    agents,
    isPending: agentsQuery.isPending,
    isError: agentsQuery.isError,
    queryError: agentsQuery.error,
    refetch: agentsQuery.refetch,
    selection,
    dirty,
    pending,
    error,
    toggle,
    save,
  };
}
