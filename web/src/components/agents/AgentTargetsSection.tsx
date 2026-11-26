import { useState } from "react";
import { ApiError } from "../../api/client.js";
import { setAgentTargets, type AgentRosterSummary } from "../../api/identity.js";
import { agentDisplayName } from "../../shared/agent-label.js";
import { Button } from "../ui/Button.js";
import { useToast } from "../ui/Toast.js";

export interface AgentTargetsSectionProps {
  agent: AgentRosterSummary;
  /** 可选目标：同项目之外的 Agent，自身不可选 */
  allAgents: readonly AgentRosterSummary[];
  onSaved: () => void;
}

/** 委派白名单：该 Agent 可以向哪些 Agent 发 A2A 消息，保存即生效 */
export function AgentTargetsSection({ agent, allAgents, onSaved }: AgentTargetsSectionProps) {
  const toast = useToast();
  const [draft, setDraft] = useState<string[]>(agent.allowedTargets);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = allAgents.filter((other) => other.id !== agent.id);
  const dirty =
    draft.length !== agent.allowedTargets.length ||
    draft.some((id) => !agent.allowedTargets.includes(id));

  function toggle(targetId: string): void {
    setDraft((current) =>
      current.includes(targetId)
        ? current.filter((id) => id !== targetId)
        : [...current, targetId],
    );
    setError(null);
  }

  async function save(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await setAgentTargets(agent.id, draft);
      toast.push("委派白名单已保存", "positive");
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "保存失败，请稍后再试");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="py-4 border-b border-line-soft first:pt-0 last:pb-0 last:border-b-0">
      <h3 className="mb-1 text-md font-bold">委派白名单</h3>
      <p className="mb-3 text-xs text-muted">
        勾选后该 Agent 可以向对方发送 A2A 消息；空白名单意味着不能主动发起委派。
      </p>
      {candidates.length === 0 ? (
        <p className="text-muted">没有其他可委派的 Agent。</p>
      ) : (
        <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto p-3 border border-border rounded-md bg-surface-2">
          {candidates.map((other) => (
            <label key={other.id} className="flex items-center gap-2 text-sm max-md:min-h-touch">
              <input
                type="checkbox"
                checked={draft.includes(other.id)}
                disabled={pending}
                onChange={() => toggle(other.id)}
              />
              <span>{agentDisplayName(other)}</span>
              <span className="text-xs text-muted overflow-hidden text-ellipsis whitespace-nowrap">{other.project}</span>
            </label>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || !dirty}
          onClick={() => void save()}
        >
          {pending ? "保存中…" : "保存白名单"}
        </Button>
      </div>
      {error === null ? null : (
        <p className="mt-3 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
