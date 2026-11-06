import { useState } from "react";
import { ApiError } from "../../api/client.js";
import { setAgentTargets, type AgentRosterSummary } from "../../api/identity.js";
import { Button } from "../ui/Button.js";
import { useToast } from "../ui/Toast.js";
import styles from "./agents.module.css";

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
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>委派白名单</h3>
      <p className={styles.sectionHint}>
        勾选后该 Agent 可以向对方发送 A2A 消息；空白名单意味着不能主动发起委派。
      </p>
      {candidates.length === 0 ? (
        <p className={styles.muted}>没有其他可委派的 Agent。</p>
      ) : (
        <div className={styles.targets}>
          {candidates.map((other) => (
            <label key={other.id} className={styles.targetRow}>
              <input
                type="checkbox"
                checked={draft.includes(other.id)}
                disabled={pending}
                onChange={() => toggle(other.id)}
              />
              <span>{other.displayName}</span>
              <span className={styles.identitySub}>{other.project}</span>
            </label>
          ))}
        </div>
      )}
      <div className={styles.rowActionsLeft}>
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
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
