import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  Cpu,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../api/client.js";
import { fetchOverview } from "../api/overview.js";
import { fetchAgents, type AgentRosterSummary } from "../api/identity.js";
import { AgentDeleteDialog } from "../components/agents/AgentDeleteDialog.js";
import { AgentDetailDialog } from "../components/agents/AgentDetailDialog.js";
import { AgentEditDialog } from "../components/agents/AgentEditDialog.js";
import { AgentManagementTable } from "../components/agents/AgentManagementTable.js";
import { AgentRegisterDialog } from "../components/identity/AgentRegisterDialog.js";
import { AgentRotateDialog } from "../components/identity/AgentRotateDialog.js";
import { Button } from "../components/ui/Button.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { ErrorState } from "../components/ui/ErrorState.js";
import { LoadingState } from "../components/ui/LoadingState.js";
import { PageFooter } from "../components/ui/PageFooter.js";
import { SectionHeader } from "../components/ui/SectionHeader.js";
import { StatCard } from "../components/ui/StatCard.js";
import { ToneIcon } from "../components/ui/ToneIcon.js";
import { formatExactTokens, formatTokens } from "../shared/format.js";
import { VISIBILITY_NOTE } from "../shared/labels.js";
import type { Tone } from "../shared/tone.js";
import styles from "./OverviewPage.module.css";

interface AttentionRow {
  icon: ReactNode;
  tone: Tone;
  text: string;
}

/** 需要人工看一眼的事：语义色图标 + 文案双编码，不靠颜色单独表意 */
function attentionRows(
  pendingApprovals: number,
  heartbeatTimeouts: number,
  todayTokens: number,
): AttentionRow[] {
  const rows: AttentionRow[] = [];
  if (heartbeatTimeouts > 0) {
    rows.push({
      icon: <AlertTriangle size={14} aria-hidden="true" />,
      tone: "warning",
      text: `${heartbeatTimeouts} 个 Agent 心跳超时，可能已离线`,
    });
  }
  if (pendingApprovals > 0) {
    rows.push({
      icon: <ShieldAlert size={14} aria-hidden="true" />,
      tone: "danger",
      text: `${pendingApprovals} 项授权待批准，未批准不可执行`,
    });
  }
  if (rows.length === 0) {
    rows.push({
      icon: <CheckCircle2 size={14} aria-hidden="true" />,
      tone: "positive",
      text: "暂无异常与待决策项",
    });
  }
  rows.push({
    icon: <CircleDollarSign size={14} aria-hidden="true" />,
    tone: "info",
    text: `今日 Token ${formatExactTokens(todayTokens)}，未配置预算`,
  });
  return rows;
}

export function OverviewPage() {
  const navigate = useNavigate();
  const [registerDialog, setRegisterDialog] = useState<"agent" | null>(null);
  const [rotateAgent, setRotateAgent] = useState<AgentRosterSummary | null>(null);
  const [detailAgentId, setDetailAgentId] = useState<string | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["overview"],
    queryFn: fetchOverview,
    retry: (count, caught) =>
      !(caught instanceof ApiError && caught.status === 401) && count < 2,
  });
  const rosterQuery = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });

  const agents = data?.agents ?? [];
  const online = agents.filter((agent) => agent.heartbeat === "ok").length;
  const idle = agents.filter((agent) => agent.heartbeat === "ok" && !agent.running).length;
  const offline =
    (data?.metrics.heartbeatTimeouts ?? 0) +
    agents.filter((agent) => agent.heartbeat === "offline").length;
  const roster = rosterQuery.data ?? [];
  const disabledCount = roster.filter((agent) => agent.status === "disabled").length;
  const empty = roster.length === 0 && agents.length === 0;

  return (
    <div className={styles.page}>
      {isPending ? <LoadingState label="加载总览…" /> : null}

      {isError ? (
        <ErrorState
          message={error instanceof ApiError ? error.message : "总览加载失败"}
          onRetry={() => void refetch()}
        />
      ) : null}

      {data === undefined ? null : (
        <>
          <section className={styles.metrics} aria-label="关键指标">
            <StatCard
              icon={<Users size={16} aria-hidden="true" />}
              label="Agent 在线"
              value={`${online} / ${agents.length}`}
              sub={`${idle} 台空闲 · ${offline} 离线`}
            />
            <StatCard
              icon={<Cpu size={16} aria-hidden="true" />}
              label="Agent 名册"
              value={String(roster.length)}
              sub={disabledCount === 0 ? "全部启用" : `${disabledCount} 个已停用`}
            />
            <StatCard
              icon={<Activity size={16} aria-hidden="true" />}
              label="运行中任务"
              value={String(data.metrics.runningTasks)}
              sub={`${data.metrics.pendingApprovals} 项待你批准`}
            />
            <StatCard
              icon={<ShieldAlert size={16} aria-hidden="true" />}
              label="待你批准"
              value={String(data.metrics.pendingApprovals)}
              sub="未批准不可执行"
            />
            <StatCard
              icon={<CircleDollarSign size={16} aria-hidden="true" />}
              label="今日 Token"
              value={formatTokens(data.metrics.todayTokens)}
              sub={`${formatExactTokens(data.metrics.todayTokens)} tok`}
              title={formatExactTokens(data.metrics.todayTokens)}
            />
          </section>

          <section className={styles.section}>
            <SectionHeader
              title="Agent 管理"
              hint="名册里的每个 Agent 都在这里，可以改名、停用、调整白名单或删除"
              actions={
                <>
                  <Button size="sm" onClick={() => navigate("/onboarding")}>
                    接入执行机
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => setRegisterDialog("agent")}>
                    注册 Agent
                  </Button>
                </>
              }
            />
            {empty ? (
              <EmptyState
                icon={<Users size={28} aria-hidden="true" />}
                title="名册里还没有 Agent"
                description="先注册 Agent，执行机装好 aw-node 后会自动出现在这里。"
              />
            ) : (
              <AgentManagementTable
                liveAgents={agents}
                onOpenDetail={(agent) => setDetailAgentId(agent.id)}
                onEdit={(agent) => setEditingAgentId(agent.id)}
                onRotateKey={setRotateAgent}
              />
            )}
          </section>

          <section className={styles.section}>
            <SectionHeader title="需要你看一眼" hint="只放异常与待决策，不是消息流" />
            <ul className={styles.attention}>
              {attentionRows(
                data.metrics.pendingApprovals,
                data.metrics.heartbeatTimeouts,
                data.metrics.todayTokens,
              ).map((row) => (
                <li key={row.text} className={styles.attentionRow}>
                  <ToneIcon tone={row.tone} icon={row.icon} />
                  <span>{row.text}</span>
                </li>
              ))}
            </ul>
          </section>

          {registerDialog === "agent" ? (
            <AgentRegisterDialog onClose={() => setRegisterDialog(null)} />
          ) : null}
          {detailAgentId === null ? null : (
            <AgentDetailDialog
              agentId={detailAgentId}
              live={agents.find((agent) => agent.id === detailAgentId)}
              onClose={() => setDetailAgentId(null)}
            />
          )}
          {rotateAgent === null ? null : (
            <AgentRotateDialog agent={rotateAgent} onClose={() => setRotateAgent(null)} />
          )}
          {editingAgentId === null ? null : (
            <AgentEditDialog
              agentId={editingAgentId}
              onClose={() => setEditingAgentId(null)}
              onRequestDelete={(agentId) => {
                setEditingAgentId(null);
                setDeletingAgentId(agentId);
              }}
            />
          )}
          {deletingAgentId === null ? null : (
            <AgentDeleteDialog
              agentId={deletingAgentId}
              onClose={() => setDeletingAgentId(null)}
              onDeleted={() => setDeletingAgentId(null)}
            />
          )}
        </>
      )}

      <PageFooter>可见性说明：{VISIBILITY_NOTE}</PageFooter>
    </div>
  );
}
