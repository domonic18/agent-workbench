import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../../api/client.js";
import {
  createAgentGroup,
  deleteAgentGroup,
  fetchAgentGroups,
  updateAgentGroup,
} from "../../api/agent-groups.js";
import type { AgentGroupSummary } from "../../api/types.js";

export interface AgentGroupsApi {
  groups: AgentGroupSummary[];
  isPending: boolean;
  isError: boolean;
  error: string | null;
  pending: boolean;
  create: (name: string, memberIds: string[]) => Promise<void>;
  update: (id: string, input: { name?: string; memberIds?: string[] }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refetch: () => Promise<unknown>;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * 委派目标组的数据与写操作。
 *
 * 组本身是独立实体(建组/改名/成员),与「谁可以委派给谁」的草稿分开保存——
 * 组的变更即时落库,委派边的变更仍走草稿统一保存。
 */
export function useAgentGroups(): AgentGroupsApi {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["agent-groups"], queryFn: fetchAgentGroups });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (input: {
      action: "create" | "update" | "remove";
      id?: string;
      name?: string;
      memberIds?: string[];
    }) => {
      if (input.action === "create") {
        await createAgentGroup({ name: input.name ?? "", memberIds: input.memberIds ?? [] });
        return;
      }
      if (input.action === "update" && input.id !== undefined) {
        await updateAgentGroup(input.id, {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.memberIds === undefined ? {} : { memberIds: input.memberIds }),
        });
        return;
      }
      if (input.id !== undefined) {
        await deleteAgentGroup(input.id);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["agent-groups"] });
    },
  });

  async function run(input: Parameters<typeof mutation.mutateAsync>[0]): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await mutation.mutateAsync(input);
    } catch (caught) {
      setError(messageOf(caught, "组操作失败，请稍后再试"));
    } finally {
      setPending(false);
    }
  }

  return {
    groups: query.data ?? [],
    isPending: query.isPending,
    isError: query.isError,
    error,
    pending,
    create: (name, memberIds) => run({ action: "create", name, memberIds }),
    update: (id, input) =>
      run({
        action: "update",
        id,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.memberIds === undefined ? {} : { memberIds: input.memberIds }),
      }),
    remove: (id) => run({ action: "remove", id }),
    refetch: query.refetch,
  };
}
