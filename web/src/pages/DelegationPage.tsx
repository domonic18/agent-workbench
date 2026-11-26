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

type View = "graph" | "table";

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
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-4 max-md:flex-col max-md:items-stretch">
        <div className="flex flex-col gap-1 min-w-0">
          <h2 className="m-0 text-lg font-bold text-foreground">委派关系</h2>
        </div>
        <div className="flex flex-none items-center gap-3 max-md:flex-wrap">
          <input
            className="px-2 py-1 border border-border-strong rounded-md bg-surface text-foreground text-sm min-w-[180px]"
            value={keyword}
            placeholder="按名称 / 项目筛选"
            aria-label="筛选 Agent"
            onChange={(event) => setKeyword(event.target.value)}
          />
          <div className="flex gap-1" role="group" aria-label="委派视图切换">
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
          <EmptyState title="暂无 Agent" />
        ) : (
          <div className="flex items-start gap-4 max-lg:flex-col">
            <div className="flex flex-1 min-w-0 flex-col gap-2 h-[clamp(460px,72vh,900px)]">
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
                <p className="m-0 text-sm text-warning">{draft.dirty.length} 个发起方有未保存的改动。</p>
              )}
              {draft.error === null ? null : (
                <p className="m-0 text-sm text-danger" role="alert">
                  {draft.error}
                </p>
              )}
            </div>
            <aside className="flex flex-none flex-col gap-3 w-80 max-lg:flex-auto max-lg:w-full">
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
