import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ApiError } from "../../api/client.js";
import { fetchAgents, setAgentTargets, type AgentSummary } from "../../api/identity.js";
import { EmptyState } from "../data/EmptyState.js";
import styles from "./DelegationMatrix.module.css";

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

type Selection = Record<string, string[]>;

/** 行=发起方,列=收件方;保存即写 allowed_targets_json,下一次 a2a.send 判定立即生效 */
export function DelegationMatrix() {
  const queryClient = useQueryClient();
  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });
  const [draft, setDraft] = useState<Selection | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const saved = useMemo(() => {
    const map: Selection = {};
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
      await queryClient.invalidateQueries({ queryKey: ["agents"] });
      setDraft(null);
    } catch (caught) {
      setError(messageOf(caught, "保存失败，请稍后再试"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.section} aria-label="委派矩阵">
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title}>委派矩阵</h2>
          <p className={styles.hint}>
            行=发起方，列=收件方；勾选即允许该发起方向该收件方发送 A2A 消息。默认全不勾，自我委派不可选。
          </p>
        </div>
        <button
          type="button"
          className={styles.save}
          disabled={pending || dirty.length === 0}
          onClick={() => void save()}
        >
          {pending ? "保存中…" : "保存委派"}
        </button>
      </header>

      {agentsQuery.isPending ? <p className={styles.loading}>加载中…</p> : null}

      {agentsQuery.isError ? (
        <div className={styles.errorBox} role="alert">
          <span>
            {agentsQuery.error instanceof ApiError
              ? agentsQuery.error.message
              : "Agent 列表加载失败"}
          </span>
          <button
            type="button"
            className={styles.retry}
            onClick={() => void agentsQuery.refetch()}
          >
            重试
          </button>
        </div>
      ) : null}

      {!agentsQuery.isPending && !agentsQuery.isError ? (
        agents.length === 0 ? (
          <EmptyState
            title="暂无 Agent"
            description="先注册 Agent，才能在这里配置谁能找谁。"
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col" className={styles.corner}>
                    发起方 \ 收件方
                  </th>
                  {agents.map((agent) => (
                    <th key={agent.id} scope="col" title={agent.id}>
                      {agent.displayName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map((initiator) => (
                  <tr key={initiator.id}>
                    <th scope="row" className={styles.rowHead} title={initiator.id}>
                      {initiator.displayName}
                    </th>
                    {agents.map((recipient) => {
                      const self = initiator.id === recipient.id;
                      const checked =
                        !self && (selection[initiator.id] ?? []).includes(recipient.id);
                      return (
                        <td key={recipient.id} className={self ? styles.selfCell : styles.cell}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={self || pending}
                            onChange={() => toggle(initiator, recipient)}
                            aria-label={`${initiator.displayName} 委派给 ${recipient.displayName}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {dirty.length === 0 ? null : (
        <p className={styles.dirtyNote}>{dirty.length} 个发起方有未保存的改动。</p>
      )}

      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
