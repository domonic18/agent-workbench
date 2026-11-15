import { useMemo, useState } from "react";
import { Network, Table as TableIcon } from "lucide-react";
import { ApiError } from "../api/client.js";
import { DelegationCanvas } from "../components/delegation/DelegationCanvas.js";
import { DelegationEditor } from "../components/delegation/DelegationEditor.js";
import { DelegationTable } from "../components/delegation/DelegationTable.js";
import { GroupPanel } from "../components/delegation/GroupPanel.js";
import { useAgentGroups } from "../components/delegation/useAgentGroups.js";
import { useDelegationDraft } from "../components/delegation/useDelegationDraft.js";
import { Button } from "../components/ui/Button.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { ErrorState } from "../components/ui/ErrorState.js";
import { IconButton } from "../components/ui/IconButton.js";
import { LoadingState } from "../components/ui/LoadingState.js";
import { agentDisplayName } from "../shared/agent-label.js";
import styles from "./DelegationPage.module.css";

type View = "graph" | "table";

const HINT: Record<View, string> = {
  graph:
    "节点=Agent，箭头=可委派方向（发起方 → 收件方）；滚轮缩放、拖空白平移，从节点右侧手柄拖到目标即建立委派。",
  table: "行=发起方，列=收件方（Agent 或组）；勾选即允许该发起方向该收件方发送 A2A 消息。默认全不勾，自我委派不可选。",
};

/**
 * 委派关系屏:谁能找谁。
 *
 * 图是主视图(整块画布,可缩放平移,可拖线),表是批量勾选与核对用的;
 * 两者共用同一份草稿,保存语义恒为「只提交变更过的发起方行」。
 */
export function DelegationPage() {
  const draft = useDelegationDraft();
  const groupsApi = useAgentGroups();
  const [view, setView] = useState<View>("graph");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");

  const keywordTrimmed = keyword.trim().toLowerCase();
  const agents = useMemo(() => {
    if (keywordTrimmed === "") return draft.agents;
    return draft.agents.filter((agent) =>
      `${agentDisplayName(agent)} ${agent.project} ${agent.id}`
        .toLowerCase()
        .includes(keywordTrimmed),
    );
  }, [draft.agents, keywordTrimmed]);

  function toggleTarget(initiatorId: string, targetId: string): void {
    const initiator = draft.agents.find((agent) => agent.id === initiatorId);
    if (initiator === undefined) return;
    draft.toggle(initiator, targetId);
    setSelectedId(initiatorId);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title}>委派关系</h2>
          <p className={styles.hint}>{HINT[view]}</p>
        </div>
        <div className={styles.headerActions}>
          <input
            className={styles.search}
            value={keyword}
            placeholder="按名称 / 项目筛选"
            aria-label="筛选 Agent"
            onChange={(event) => setKeyword(event.target.value)}
          />
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
          <Button
            variant="primary"
            disabled={draft.pending || draft.dirty.length === 0}
            onClick={() => void draft.save()}
          >
            {draft.pending ? "保存中…" : "保存委派"}
          </Button>
        </div>
      </header>

      {draft.isPending ? <LoadingState label="加载 Agent 名册…" /> : null}

      {draft.isError ? (
        <ErrorState
          message={
            draft.queryError instanceof ApiError
              ? draft.queryError.message
              : "Agent 列表加载失败"
          }
          onRetry={() => void draft.refetch()}
        />
      ) : null}

      {!draft.isPending && !draft.isError ? (
        draft.agents.length === 0 ? (
          <EmptyState title="暂无 Agent" description="先注册 Agent，才能在这里配置谁能找谁。" />
        ) : (
          <div className={styles.body}>
            <div className={styles.canvasArea}>
              {view === "graph" ? (
                <DelegationCanvas
                  agents={agents}
                  groups={groupsApi.groups}
                  selection={draft.selection}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onToggleTarget={toggleTarget}
                />
              ) : (
                <DelegationTable draft={draft} groups={groupsApi.groups} />
              )}
              {draft.dirty.length === 0 ? null : (
                <p className={styles.dirtyNote}>{draft.dirty.length} 个发起方有未保存的改动。</p>
              )}
              {draft.error === null ? null : (
                <p className={styles.error} role="alert">
                  {draft.error}
                </p>
              )}
            </div>
            <aside className={styles.side}>
              {view === "graph" ? (
                <DelegationEditor draft={draft} groups={groupsApi.groups} selectedId={selectedId} />
              ) : null}
              <GroupPanel groupsApi={groupsApi} agents={draft.agents} />
            </aside>
          </div>
        )
      ) : null}
    </div>
  );
}
