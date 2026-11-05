import { type FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../../api/client.js";
import { completeSetup, type BootstrapStatus } from "../../../api/bootstrap.js";
import { fetchAgents } from "../../../api/identity.js";
import { StepHeader } from "../StepHeader.js";
import { Feedback } from "../Feedback.js";
import styles from "../setup.module.css";

export function StepBugfix({
  step,
  status,
  onComplete,
}: {
  step: number;
  status: BootstrapStatus;
  onComplete: () => void;
}) {
  const [primaryAgentId, setPrimaryAgentId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agents = useQuery({
    queryKey: ["identity", "agents"],
    queryFn: fetchAgents,
    retry: false,
  });

  const definition = status.definition;
  const activeAgents = (agents.data ?? []).filter((agent) => agent.status === "active");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (primaryAgentId === "") {
      setError("请选择主责 Agent");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await completeSetup(primaryAgentId);
      onComplete();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "装配失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.card}>
      <StepHeader step={step} />
      <h1 className={styles.title}>启用 Bug 工作流</h1>
      <p className={styles.description}>核对默认 bug_fix 装配摘要,选择主责 Agent 后完成初始化。无需手工编辑 RouteRule 或 Mandate。</p>
      <div className={styles.section}>
        <div><strong>预期结果</strong></div>
        <p className={styles.hint}>{definition.mandate.expectedResult}</p>
        <div><strong>范围</strong></div>
        <p className={styles.hint}>{definition.mandate.scope}</p>
        <div><strong>验收证据</strong></div>
        <ul className={styles.evidence}>
          {definition.evidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <label className={styles.label} htmlFor="primary">主责 Agent</label>
        <select
          id="primary"
          className={styles.input}
          value={primaryAgentId}
          onChange={(event) => setPrimaryAgentId(event.target.value)}
        >
          <option value="">— 选择 —</option>
          {activeAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.displayName} ({agent.project})
            </option>
          ))}
        </select>
        <button className={styles.button} type="submit" disabled={pending}>
          {pending ? "装配中…" : "确认并开始使用"}
        </button>
        <Feedback error={error} />
      </form>
    </div>
  );
}
