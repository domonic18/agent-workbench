import type { AgentSummary } from "../../api/identity.js";
import type { AgentGroupSummary } from "../../api/types.js";
import { agentDisplayName } from "../../shared/agent-label.js";
import { Table, type TableColumn } from "../ui/Table.js";
import type { DelegationDraft } from "./useDelegationDraft.js";
import { cn } from "../../lib/utils.js";

export interface DelegationTableProps {
  draft: DelegationDraft;
  groups: AgentGroupSummary[];
}

/**
 * 委派矩阵:行=发起方,列=收件方(Agent 或组)。
 *
 * 图是主视图,这张表是批量勾选与核对用的——两处共用同一份草稿。
 */
export function DelegationTable({ draft, groups }: DelegationTableProps) {
  const { agents, selection, pending } = draft;

  const columns: TableColumn<AgentSummary>[] = [
    {
      key: "corner",
      header: "发起方 \\ 收件方",
      plain: true,
      width: "180px",
      render: (initiator) => (
        <span className={"block max-w-[180px] overflow-hidden text-ellipsis"} title={initiator.id}>
          {agentDisplayName(initiator)}
        </span>
      ),
    },
    ...agents.map((recipient) => ({
      key: recipient.id,
      header: agentDisplayName(recipient),
      plain: true,
      align: "center" as const,
      render: (initiator: AgentSummary) => {
        const self = initiator.id === recipient.id;
        const checked = !self && (selection[initiator.id] ?? []).includes(recipient.id);
        return (
          <span className={cn(
            self
              ? "inline-flex items-center justify-center w-control-md h-control-md rounded-sm bg-surface-3"
              : "inline-flex items-center justify-center w-control-md h-control-md rounded-sm",
          )}>
            <input
              type="checkbox"
              checked={checked}
              disabled={self || pending}
              onChange={() => draft.toggle(initiator, recipient.id)}
              aria-label={`${agentDisplayName(initiator)} 委派给 ${recipient.displayName}`}
              className={cn("w-[15px] h-[15px] cursor-pointer max-md:w-5 max-md:h-5", self && "cursor-not-allowed")}
            />
          </span>
        );
      },
    })),
    ...groups.map((group) => ({
      key: group.id,
      header: `组 · ${group.name}`,
      plain: true,
      align: "center" as const,
      render: (initiator: AgentSummary) => {
        const checked = (selection[initiator.id] ?? []).includes(group.id);
        return (
          <span className={"inline-flex items-center justify-center w-control-md h-control-md rounded-sm"}>
            <input
              type="checkbox"
              checked={checked}
              disabled={pending}
              onChange={() => draft.toggle(initiator, group.id)}
              aria-label={`${agentDisplayName(initiator)} 委派给组 ${group.name}`}
              className="w-[15px] h-[15px] cursor-pointer max-md:w-5 max-md:h-5"
            />
          </span>
        );
      },
    })),
  ];

  return (
    <div className={"border border-border rounded-lg bg-surface overflow-hidden"}>
      <Table
        columns={columns}
        rows={agents}
        rowKey={(agent) => agent.id}
        fixedLayout
        rowHeader
        minWidth={`${180 + (agents.length + groups.length) * 64}px`}
      />
    </div>
  );
}
