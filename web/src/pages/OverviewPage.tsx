import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CircleDollarSign,
  Cpu,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../api/client.js";
import { fetchOverview } from "../api/overview.js";
import { fetchAgents, type AgentRosterSummary } from "../api/identity.js";
import { AgentDeleteDialog } from "../components/agents/AgentDeleteDialog.js";
import { AgentEditDialog } from "../components/agents/AgentEditDialog.js";
import { AgentManagementTable } from "../components/agents/AgentManagementTable.js";
import { MetricCard } from "../components/data/MetricCard.js";
import { AgentRegisterDialog } from "../components/identity/AgentRegisterDialog.js";
import { AgentRotateDialog } from "../components/identity/AgentRotateDialog.js";
import { MachineRegisterDialog } from "../components/identity/MachineRegisterDialog.js";
import { formatExactTokens, formatTokens } from "../shared/format.js";
import { VISIBILITY_NOTE } from "../shared/labels.js";
import styles from "./OverviewPage.module.css";

function attentionRows(
  pendingApprovals: number,
  heartbeatTimeouts: number,
  todayTokens: number,
): { icon: string; text: string }[] {
  const rows: { icon: string; text: string }[] = [];
  if (heartbeatTimeouts > 0) {
    rows.push({ icon: "⚠", text: `${heartbeatTimeouts} 个 Agent 心跳超时，可能已离线` });
  }
  if (pendingApprovals > 0) {
    rows.push({ icon: "⛔", text: `${pendingApprovals} 项授权待批准，未批准不可执行` });
  }
  if (rows.length === 0) {
    rows.push({ icon: "✅", text: "暂无异常与待决策项" });
  }
  rows.push({ icon: "💰", text: `今日 Token ${formatExactTokens(todayTokens)}，未配置预算` });
  return rows;
}

export function OverviewPage() {
  const navigate = useNavigate();
  const [registerDialog, setRegisterDialog] = useState<"agent" | "machine" | null>(null);
  const [rotateAgent, setRotateAgent] = useState<AgentRosterSummary | null>(null);
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

  return (
    <div className={styles.page}>
      {isPending ? <p className={styles.state}>加载中…</p> : null}

      {isError ? (
        <div className={styles.error} role="alert">
          <span>{error instanceof ApiError ? error.message : "总览加载失败"}</span>
          <button type="button" className={styles.retry} onClick={() => void refetch()}>
            重试
          </button>
        </div>
      ) : null}

      {data === undefined ? null : (
        <>
          <section className={styles.metrics} aria-label="关键指标">
            <MetricCard
              icon={<Users size={14} />}
              label="Agent 在线"
              value={`${online} / ${agents.length}`}
              sub={`${idle} 台空闲 · ${offline} 离线`}
            />
            <MetricCard
              icon={<Cpu size={14} />}
              label="Agent 名册"
              value={String(roster.length)}
              sub={disabledCount === 0 ? "全部启用" : `${disabledCount} 个已停用`}
            />
            <MetricCard
              icon={<Activity size={14} />}
              label="运行中任务"
              value={String(data.metrics.runningTasks)}
              sub={`${data.metrics.pendingApprovals} 项待你批准`}
            />
            <MetricCard
              icon={<ShieldAlert size={14} />}
              label="待你批准"
              value={String(data.metrics.pendingApprovals)}
              sub="未批准不可执行"
            />
            <MetricCard
              icon={<CircleDollarSign size={14} />}
              label="今日 Token"
              value={formatTokens(data.metrics.todayTokens)}
              sub={`${formatExactTokens(data.metrics.todayTokens)} tok`}
              title={formatExactTokens(data.metrics.todayTokens)}
            />
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionHeading}>
                <h2 className={styles.sectionTitle}>Agent 管理</h2>
                <span className={styles.hint}>名册里的每个 Agent 都在这里，可以改名、停用、调整白名单或删除</span>
              </div>
              <div className={styles.sectionActions}>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => setRegisterDialog("machine")}
                >
                  机器登记
                </button>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => navigate("/onboarding")}
                >
                  接入执行机
                </button>
                <button
                  type="button"
                  className={styles.actionPrimary}
                  onClick={() => setRegisterDialog("agent")}
                >
                  注册 Agent
                </button>
              </div>
            </div>
            <AgentManagementTable
              liveAgents={agents}
              onEdit={(agent) => setEditingAgentId(agent.id)}
              onRotateKey={setRotateAgent}
            />
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionHeading}>
                <h2 className={styles.sectionTitle}>需要你看一眼</h2>
                <span className={styles.hint}>只放异常与待决策，不是消息流</span>
              </div>
            </div>
            <ul className={styles.attention}>
              {attentionRows(
                data.metrics.pendingApprovals,
                data.metrics.heartbeatTimeouts,
                data.metrics.todayTokens,
              ).map((row) => (
                <li key={row.text} className={styles.attentionRow}>
                  <span className={styles.attentionIcon} aria-hidden="true">
                    {row.icon}
                  </span>
                  <span>{row.text}</span>
                </li>
              ))}
            </ul>
          </section>

          {registerDialog === "agent" ? (
            <AgentRegisterDialog onClose={() => setRegisterDialog(null)} />
          ) : null}
          {registerDialog === "machine" ? (
            <MachineRegisterDialog onClose={() => setRegisterDialog(null)} />
          ) : null}
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

      <p className={styles.note}>可见性说明：{VISIBILITY_NOTE}</p>
    </div>
  );
}
