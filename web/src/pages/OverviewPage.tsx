import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../api/client.js";
import { fetchOverview } from "../api/overview.js";
import { useRealtimeStream } from "../api/stream.js";
import { AgentTable } from "../components/data/AgentTable.js";
import { EmptyState } from "../components/data/EmptyState.js";
import { MetricCard } from "../components/data/MetricCard.js";
import { StatusBadge } from "../components/data/StatusBadge.js";
import { formatExactTokens, formatTokens } from "../shared/format.js";
import {
  REALTIME_LABEL,
  REALTIME_TONE,
  VISIBILITY_NOTE,
} from "../shared/labels.js";
import styles from "./OverviewPage.module.css";

const OVERVIEW_SCOPES: readonly string[] = ["overview"];

export function OverviewPage() {
  const realtime = useRealtimeStream(OVERVIEW_SCOPES);
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["overview"],
    queryFn: fetchOverview,
    retry: (count, caught) =>
      !(caught instanceof ApiError && caught.status === 401) && count < 2,
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>总览</h1>
          <p className={styles.subtitle}>谁在跑、跑到哪、用了多少 token</p>
        </div>
        <StatusBadge tone={REALTIME_TONE[realtime]} text={REALTIME_LABEL[realtime]} />
      </header>

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
            <MetricCard label="运行中 Agent" value={String(data.metrics.runningAgents)} />
            <MetricCard label="运行中任务" value={String(data.metrics.runningTasks)} />
            <MetricCard
              label="今日 Token"
              value={formatTokens(data.metrics.todayTokens)}
              title={formatExactTokens(data.metrics.todayTokens)}
            />
            <MetricCard label="待确认" value={String(data.metrics.pendingApprovals)} />
            <MetricCard label="心跳超时" value={String(data.metrics.heartbeatTimeouts)} />
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Agent</h2>
            {data.agents.length === 0 ? (
              <EmptyState
                title="采集器未上报"
                description="没有在线 Agent 的上报数据。请确认采集器已启动，并完成机器登记。"
              />
            ) : (
              <AgentTable agents={data.agents} />
            )}
          </section>
        </>
      )}

      <p className={styles.note}>可见性说明：{VISIBILITY_NOTE}</p>
    </div>
  );
}
