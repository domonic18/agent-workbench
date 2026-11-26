import { X } from "lucide-react";
import type { AgentGroupSummary } from "../../api/types.js";
import { agentDisplayName } from "../../shared/agent-label.js";
import { Button } from "../ui/Button.js";
import type { DelegationDraft } from "./useDelegationDraft.js";
import { cn } from "../../lib/utils.js";

export interface DelegationEditorProps {
  draft: DelegationDraft;
  groups: AgentGroupSummary[];
  /** 当前选中的发起方;null 表示未选中 */
  selectedId: string | null;
}

/**
 * 选中发起方后的编辑面板:收件方 chips + 组 chips + 保存。
 *
 * 画布上的拖拽连线是快捷路径,这里是等价的可键盘操作路径。
 */
export function DelegationEditor({ draft, groups, selectedId }: DelegationEditorProps) {
  const { agents, selection, dirty, pending, error } = draft;
  const selected = agents.find((agent) => agent.id === selectedId) ?? null;
  if (selected === null) {
    return (
      <p className={"m-0 text-sm text-muted"}>
        点节点选中发起方，或从节点右侧手柄拖一条线到目标节点，即可建立委派。
      </p>
    );
  }

  const targets = selection[selected.id] ?? [];
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const recipients = targets
    .map((id) => {
      const agent = agentById.get(id);
      if (agent !== undefined) {
        return { id, label: agentDisplayName(agent), kind: "agent" as const };
      }
      const group = groupById.get(id);
      if (group !== undefined) {
        return { id, label: `组 · ${group.name}`, kind: "group" as const };
      }
      return { id, label: id, kind: "unknown" as const };
    })
    .filter((item) => item.kind !== "unknown");

  const candidates: Array<{ id: string; label: string }> = [
    ...agents
      .filter((agent) => agent.id !== selected.id && !targets.includes(agent.id))
      .map((agent) => ({ id: agent.id, label: agentDisplayName(agent) })),
    ...groups
      .filter((group) => !targets.includes(group.id))
      .map((group) => ({ id: group.id, label: `组 · ${group.name}` })),
  ];

  return (
    <div className={"flex flex-col gap-3 p-4 border border-border rounded-lg bg-surface"} role="group" aria-label="委派编辑面板">
      <h3 className={"m-0 text-md font-bold text-foreground"}>{agentDisplayName(selected)} 可委派给</h3>
      <div className={"flex flex-wrap gap-2"}>
        {recipients.length === 0 ? (
          <span className={"text-sm text-muted"}>暂无收件方（默认全不勾）</span>
        ) : (
          recipients.map((recipient) => (
            <span
              key={recipient.id}
              className={cn(
              recipient.kind === "group"
                ? "inline-flex items-center gap-1 px-2 py-1 border border-dashed border-accent-border rounded-full bg-accent-soft text-foreground text-sm"
                : "inline-flex items-center gap-1 px-2 py-1 border border-accent-border rounded-full bg-accent-soft text-foreground text-sm",
            )}
            >
              {recipient.label}
              <button
                type="button"
                className={"inline-flex items-center justify-center w-5 h-5 p-0 border-none rounded-full bg-transparent text-muted cursor-pointer hover:text-danger"}
                aria-label={`移除 ${recipient.label}`}
                onClick={() => draft.toggle(selected, recipient.id)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))
        )}
      </div>
      <div className={"flex flex-wrap items-center gap-3"}>
        {candidates.length === 0 ? (
          <span className={"text-sm text-muted"}>没有其他目标可添加</span>
        ) : (
          <label className={"inline-flex items-center gap-2 text-sm text-text-secondary"}>
            添加收件方
            <select
              className={"px-2 py-1 border border-border-strong rounded-md bg-surface text-foreground text-sm"}
              value=""
              onChange={(event) => {
                if (event.target.value !== "") {
                  draft.toggle(selected, event.target.value);
                }
              }}
            >
              <option value="" disabled>
                选择 Agent 或组
              </option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          variant="primary"
          disabled={pending || dirty.length === 0}
          onClick={() => void draft.save()}
        >
          {pending ? "保存中…" : "保存委派"}
        </Button>
      </div>
      {dirty.length === 0 ? null : (
        <p className={"m-0 text-sm text-warning"}>{dirty.length} 个发起方有未保存的改动。</p>
      )}
      {error === null ? null : (
        <p className={"m-0 text-sm text-danger"} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
