import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../api/client.js";
import { refreshBotNames } from "../api/bootstrap.js";
import { fetchOverview } from "../api/overview.js";
import type { OverviewAgent } from "../api/types.js";
import { AgentCards } from "../components/data/AgentCards.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { MetricCard } from "../components/data/MetricCard.js";
import { AgentRegisterDialog } from "../components/identity/AgentRegisterDialog.js";
import { AgentRotateDialog } from "../components/identity/AgentRotateDialog.js";
import { MachineRegisterDialog } from "../components/identity/MachineRegisterDialog.js";
import { ExecutionSetupPanel } from "../components/setup/ExecutionSetupPanel.js";
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
  const [registerDialog, setRegisterDialog] = useState<"agent" | "machine" | null>(null);
  const [rotateAgent, setRotateAgent] = useState<OverviewAgent | null>(null);
  const [refreshingBot, setRefreshingBot] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["overview"],
    queryFn: fetchOverview,
    retry: (count, caught) =>
      !(caught instanceof ApiError && caught.status === 401) && count < 2,
  });

  const agents = data?.agents ?? [];
  const online = agents.filter((agent) => agent.heartbeat === "ok").length;
  const idle = agents.filter((agent) => agent.heartbeat === "ok" && !agent.running).length;
  const offline =
    (data?.metrics.heartbeatTimeouts ?? 0) +
    agents.filter((agent) => agent.heartbeat === "offline").length;

  async function handleRefreshBotName(agent: OverviewAgent): Promise<void> {
    if (agent.machineId === null || refreshingBot !== null) {
      return;
    }
    setRefreshingBot(agent.machineId);
    setRefreshNotice(null);
    try {
      await refreshBotNames(agent.machineId);
      setRefreshNotice(`已请求刷新 ${agent.displayName} 的飞书 bot 名,约 1 分钟内生效`);
    } catch (caught) {
      setRefreshNotice(caught instanceof ApiError ? caught.message : "刷新请求失败");
    } finally {
      setRefreshingBot(null);
    }
  }

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
              label="Agent 在线"
              value={`${online} / ${agents.length}`}
              sub={`${idle} 台空闲 · ${offline} 离线`}
            />
            <MetricCard
              label="运行中任务"
              value={String(data.metrics.runningTasks)}
              sub={`${data.metrics.pendingApprovals} 项待你批准`}
            />
            <MetricCard
              label="待你批准"
              value={String(data.metrics.pendingApprovals)}
              sub="未批准不可执行"
            />
            <MetricCard
              label="今日 Token"
              value={formatTokens(data.metrics.todayTokens)}
              sub={`${formatExactTokens(data.metrics.todayTokens)} tok`}
              title={formatExactTokens(data.metrics.todayTokens)}
            />
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionHeading}>
                <h2 className={styles.sectionTitle}>Agent</h2>
                <span className={styles.hint}>按状态排序：运行 → 等批准 → 等回应 → 空闲 → 离线</span>
                <span
                  className={styles.help}
                  title="Agent 卡片按是否运行与心跳状态排序；点击「密钥」可轮换访问凭证。"
                >
                  ?
                </span>
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
                  className={styles.actionPrimary}
                  onClick={() => setRegisterDialog("agent")}
                >
                  注册 Agent
                </button>
              </div>
            </div>
            {refreshNotice === null ? null : <p className={styles.hint}>{refreshNotice}</p>}
            {agents.length === 0 ? (
              <EmptyState
                title="采集器未上报"
                description="没有在线 Agent 的上报数据。请确认采集器已启动，并完成机器登记。"
              />
            ) : (
              <AgentCards
                agents={agents}
                onManageKey={setRotateAgent}
                onRefreshBotName={(agent) => void handleRefreshBotName(agent)}
              />
            )}
          </section>

          <section className={styles.section}>
            {/* 默认展开:下载地址是本页对外交付物,收起状态等于没做 */}
            <details className={styles.disclosure} open>
              <summary>添加执行机</summary>
              <p className={styles.hint}>
                新机器装 aw-node:复制命令到目标机执行,按提示粘贴一次性 enroll token;也可直接下载对应平台产物。
              </p>
              <ExecutionSetupPanel />
            </details>
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
        </>
      )}

      <p className={styles.note}>可见性说明：{VISIBILITY_NOTE}</p>
    </div>
  );
}
