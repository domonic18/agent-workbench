import { useState } from "react";
import { Network, Table as TableIcon } from "lucide-react";
import { ApiError } from "../../api/client.js";
import type { AgentSummary } from "../../api/identity.js";
import { agentDisplayName } from "../../shared/agent-label.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
import { IconButton } from "../ui/IconButton.js";
import { Table, type TableColumn } from "../ui/Table.js";
import { DelegationGraph } from "./DelegationGraph.js";
import { useDelegationDraft } from "./useDelegationDraft.js";
import styles from "./DelegationMatrix.module.css";

type MatrixView = "graph" | "table";

const HINT: Record<MatrixView, string> = {
  graph: "节点=Agent，箭头=可委派方向（发起方 → 收件方）；点击节点编辑，保存后下一次 a2a.send 判定立即生效。",
  table: "行=发起方，列=收件方；勾选即允许该发起方向该收件方发送 A2A 消息。默认全不勾，自我委派不可选。",
};

/** 委派白名单编辑区:图(默认)与表共用同一份草稿与保存语义 */
export function DelegationMatrix() {
  const draft = useDelegationDraft();
  const { agents, selection, dirty, pending, error } = draft;
  const [view, setView] = useState<MatrixView>("graph");

  const columns: TableColumn<AgentSummary>[] = [
    {
      key: "corner",
      header: "发起方 \\ 收件方",
      plain: true,
      width: "180px",
      render: (initiator) => (
        <span className={styles.rowHead} title={initiator.id}>
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
          <span className={self ? styles.selfCell : styles.cell}>
            <input
              type="checkbox"
              checked={checked}
              disabled={self || pending}
              onChange={() => draft.toggle(initiator, recipient)}
              aria-label={`${agentDisplayName(initiator)} 委派给 ${recipient.displayName}`}
            />
          </span>
        );
      },
    })),
  ];

  return (
    <section className={styles.section} aria-label="委派关系">
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title}>委派关系</h2>
          <p className={styles.hint}>{HINT[view]}</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.viewToggle} role="group" aria-label="委派视图切换">
            <IconButton
              label="关系图视图"
              icon={<Network size={14} />}
              aria-pressed={view === "graph"}
              onClick={() => setView("graph")}
            />
            <IconButton
              label="表格视图"
              icon={<TableIcon size={14} />}
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
            />
          </div>
          {view === "table" ? (
            <Button
              variant="primary"
              disabled={pending || dirty.length === 0}
              onClick={() => void draft.save()}
            >
              {pending ? "保存中…" : "保存委派"}
            </Button>
          ) : null}
        </div>
      </header>

      {draft.isPending ? <p className={styles.loading}>加载中…</p> : null}

      {draft.isError ? (
        <div className={styles.errorBox} role="alert">
          <span>
            {draft.queryError instanceof ApiError
              ? draft.queryError.message
              : "Agent 列表加载失败"}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void draft.refetch()}>
            重试
          </Button>
        </div>
      ) : null}

      {!draft.isPending && !draft.isError ? (
        agents.length === 0 ? (
          <EmptyState
            title="暂无 Agent"
            description="先注册 Agent，才能在这里配置谁能找谁。"
          />
        ) : view === "graph" ? (
          <DelegationGraph draft={draft} />
        ) : (
          <div className={styles.matrix}>
            <Table
              columns={columns}
              rows={agents}
              rowKey={(agent) => agent.id}
              fixedLayout
              rowHeader
              minWidth={`${180 + agents.length * 64}px`}
            />
          </div>
        )
      ) : null}

      {view === "table" && dirty.length > 0 ? (
        <p className={styles.dirtyNote}>{dirty.length} 个发起方有未保存的改动。</p>
      ) : null}

      {view === "table" && error !== null ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
