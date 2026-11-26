import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
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
import { fetchDiscovery } from "../api/bootstrap.js";
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
import { SectionHeader } from "../components/ui/SectionHeader.js";
import { StatCard } from "../components/ui/StatCard.js";
import { ToneIcon } from "../components/ui/ToneIcon.js";
import { formatExactTokens, formatTokens } from "../shared/format.js";
import { cn } from "../lib/utils.js";
import type { Tone } from "../shared/tone.js";

interface AttentionCardProps {
  tone: Tone;
  icon: ReactNode;
  title: string;
  description: string;
  action: { label: string; onClick: () => void };
}

function AttentionCard({ tone, icon, title, description, action }: AttentionCardProps) {
  const styles: Record<Tone, { border: string; bg: string }> = {
    positive: { border: "border-positive-border", bg: "bg-positive-soft" },
    warning: { border: "border-warning-border", bg: "bg-warning-soft" },
    danger: { border: "border-danger-border", bg: "bg-danger-soft" },
    info: { border: "border-info-border", bg: "bg-info-soft" },
    muted: { border: "border-border", bg: "bg-surface" },
  };
  const { border, bg } = styles[tone];
  return (
    <div
      className={cn(
        "flex items-center gap-4 p-4 border rounded-md max-md:flex-col max-md:items-start",
        border,
        bg,
      )}
    >
      <ToneIcon tone={tone} icon={icon} />
      <div className="flex-1 min-w-0">
        <h3 className="m-0 text-sm font-semibold text-foreground">{title}</h3>
        <p className="m-0 text-sm text-text-secondary">{description}</p>
      </div>
      <Button size="sm" variant="secondary" onClick={action.onClick}>
        {action.label}
      </Button>
    </div>
  );
}

interface UnregisteredProject {
  machine: string;
  name: string;
  bot?: string | undefined;
}

/** 未注册项目卡片描述:取首个项目点名,多个加「等」 */
function unregisteredDescription(projects: readonly UnregisteredProject[]): string {
  const first = projects[0]!;
  const named = first.bot === undefined ? first.name : `${first.name} · ${first.bot}`;
  const rest = projects.length > 1 ? " 等" : "";
  return `在 ${first.machine} 上发现 ${projects.length} 个未注册项目（${named}${rest}），登记后才可参与委派。`;
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
    // 派发挂起等机器侧状态随心跳(60s)更新,SSE 事件源不覆盖这类行级变化
    refetchInterval: 60_000,
    retry: (count, caught) =>
      !(caught instanceof ApiError && caught.status === 401) && count < 2,
  });
  const rosterQuery = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });
  // 已发现未注册项目:机器发现上报里有、名册里没有——不提示就永远唤不醒也不可达
  const discovery = useQuery({
    queryKey: ["discovery"],
    queryFn: fetchDiscovery,
    refetchInterval: 60_000,
  });
  const unregistered = (discovery.data?.machines ?? []).flatMap((machine) =>
    machine.projects
      .filter((project) => !project.confirmed)
      .map((project) => ({
        machine: machine.displayName ?? machine.hostname,
        name: project.name,
        bot: project.feishuBotName,
      })),
  );

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
    <div className="flex flex-col gap-6">
      {isPending ? <LoadingState label="加载总览…" /> : null}

      {isError ? (
        <ErrorState
          message={error instanceof ApiError ? error.message : "总览加载失败"}
          onRetry={() => void refetch()}
        />
      ) : null}

      {data === undefined ? null : (
        <>
          <section className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]" aria-label="关键指标">
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

          <section id="agent-management" className="flex flex-col gap-4 scroll-mt-6">
            <SectionHeader
              title="Agent 管理"
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

          {data.metrics.heartbeatTimeouts > 0 || data.metrics.pendingApprovals > 0 || unregistered.length > 0 ? (
            <section className="grid gap-3" aria-label="待处理">
              {data.metrics.heartbeatTimeouts > 0 ? (
                <AttentionCard
                  tone="warning"
                  icon={<AlertTriangle size={18} aria-hidden="true" />}
                  title="Agent 心跳超时"
                  description={`${data.metrics.heartbeatTimeouts} 个 Agent 可能已离线`}
                  action={{
                    label: "查看 Agent",
                    onClick: () => document.getElementById("agent-management")?.scrollIntoView({ behavior: "smooth" }),
                  }}
                />
              ) : null}
              {data.metrics.pendingApprovals > 0 ? (
                <AttentionCard
                  tone="danger"
                  icon={<ShieldAlert size={18} aria-hidden="true" />}
                  title="授权待批准"
                  description={`${data.metrics.pendingApprovals} 项授权未批准，不可执行`}
                  action={{ label: "去审批", onClick: () => navigate("/capabilities?view=pending") }}
                />
              ) : null}
              {unregistered.length > 0 ? (
                <AttentionCard
                  tone="warning"
                  icon={<AlertTriangle size={18} aria-hidden="true" />}
                  title="发现未注册项目"
                  description={unregisteredDescription(unregistered)}
                  action={{ label: "去登记", onClick: () => navigate("/agent-access") }}
                />
              ) : null}
            </section>
          ) : null}

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
    </div>
  );
}
