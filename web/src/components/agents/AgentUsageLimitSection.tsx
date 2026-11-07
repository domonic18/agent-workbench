import { useState } from "react";
import { ApiError } from "../../api/client.js";
import { setAgentUsageLimit, type AgentRosterSummary } from "../../api/identity.js";
import { Button } from "../ui/Button.js";
import { Field, Input } from "../ui/Field.js";
import { useToast } from "../ui/Toast.js";
import styles from "./agents.module.css";

export interface AgentUsageLimitSectionProps {
  agent: AgentRosterSummary;
  onSaved: () => void;
}

const DEFAULT_LIMIT = 500_000;
const DEFAULT_WARN = 80;

/** 日 Token 额度：超过告警线提示，达额后按 hardStop 决定停摆还是只告警 */
export function AgentUsageLimitSection({ agent, onSaved }: AgentUsageLimitSectionProps) {
  const toast = useToast();
  const limit = agent.usageLimit;
  const [dailyTokenLimit, setDailyTokenLimit] = useState(
    limit?.dailyTokenLimit ?? DEFAULT_LIMIT,
  );
  const [warnPercent, setWarnPercent] = useState(limit?.warnPercent ?? DEFAULT_WARN);
  const [hardStop, setHardStop] = useState(limit?.hardStop ?? false);
  const [isActive, setIsActive] = useState(limit?.isActive ?? true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await setAgentUsageLimit(agent.id, {
        dailyTokenLimit,
        warnPercent,
        hardStop,
        isActive,
      });
      toast.push("用量上限已保存", "positive");
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "保存失败，请稍后再试");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>用量上限</h3>
      <p className={styles.sectionHint}>
        按日累计 Token 计。达到告警线开始提醒；开启「达额停摆」后超额的运行会被拒绝。
      </p>
      <div className={styles.fieldGrid}>
        <Field label="日 Token 额度" htmlFor="usage-daily-limit">
          <Input
            id="usage-daily-limit"
            type="number"
            min={0}
            step={1000}
            value={dailyTokenLimit}
            onChange={(event) => setDailyTokenLimit(Number(event.target.value))}
          />
        </Field>
        <Field label="告警线（%）" htmlFor="usage-warn-percent">
          <Input
            id="usage-warn-percent"
            type="number"
            min={0}
            max={100}
            value={warnPercent}
            onChange={(event) => setWarnPercent(Number(event.target.value))}
          />
        </Field>
        <label className={styles.targetRow}>
          <input
            type="checkbox"
            checked={isActive}
            disabled={pending}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          <span>启用额度控制</span>
        </label>
        <label className={styles.targetRow}>
          <input
            type="checkbox"
            checked={hardStop}
            disabled={pending}
            onChange={(event) => setHardStop(event.target.checked)}
          />
          <span>达额后停摆</span>
        </label>
      </div>
      <div className={styles.rowActionsLeft}>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => void save()}>
          {pending ? "保存中…" : "保存上限"}
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
