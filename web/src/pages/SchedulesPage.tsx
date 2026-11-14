import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Clock, TriangleAlert } from "lucide-react";
import { ApiError } from "../api/client.js";
import { fetchSchedules } from "../api/schedules.js";
import type { ScheduleRow } from "../api/types.js";
import { Badge } from "../components/ui/Badge.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { ErrorState } from "../components/ui/ErrorState.js";
import { LoadingState } from "../components/ui/LoadingState.js";
import { PageFooter } from "../components/ui/PageFooter.js";
import { SectionHeader } from "../components/ui/SectionHeader.js";
import { StatCard } from "../components/ui/StatCard.js";
import { Table, type TableColumn } from "../components/ui/Table.js";
import { describeCron } from "../shared/cron.js";
import { useNow } from "../shared/useNow.js";
import { formatCountdown, formatDateTimeIn, formatRelativeTime } from "../shared/format.js";
import styles from "./SchedulesPage.module.css";

/** 24 小时内待执行的口径 */
const SOON_MS = 24 * 60 * 60 * 1000;

interface StatusView {
  tone: "positive" | "warning" | "danger" | "info" | "muted";
  text: string;
  title?: string;
}

/** 状态按「机器是否还活着 → 计划是否停用 → 上次是否出错」排序,最该先看的排最前 */
function statusOf(row: ScheduleRow, now: number): StatusView {
  if (row.stale) {
    const at = row.collectedAt === null ? null : formatRelativeTime(row.collectedAt, now);
    return {
      tone: "muted",
      text: "状态未知",
      title: at === null ? "机器离线,没有新的上报" : `最后采集于${at}`,
    };
  }
  if (!row.enabled) {
    return { tone: "muted", text: "已停用" };
  }
  if (row.lastError !== null) {
    return { tone: "danger", text: "上次出错", title: row.lastError };
  }
  return { tone: "positive", text: "正常" };
}

/** Agent 机器人:bot 名为准,其次登记名;项目没登记就如实说没登记 */
function agentLabel(row: ScheduleRow): string {
  if (row.botName !== null && row.botName !== "") return row.botName;
  if (row.agentName !== null && row.agentName !== "") return row.agentName;
  return `未登记 Agent（项目 ${row.project}）`;
}

function frequencyCell(row: ScheduleRow): { text: string; title?: string } {
  if (row.kind === "timer") {
    return { text: "一次性" };
  }
  if (row.cronExpr === null) {
    return { text: "—", title: "采集端没带 cron 表达式" };
  }
  const described = describeCron(row.cronExpr);
  if (!described.parsed) {
    return { text: "表达式无法解析", title: row.cronExpr };
  }
  return { text: described.text, title: row.cronExpr };
}

/**
 * 定时任务屏:执行机上自动跑的计划清单,只读。
 *
 * 真相源在 cc-connect 侧,这里不改频率、不停用、不触发执行。
 */
export function SchedulesPage() {
  // 计划随执行机上报变化,一分钟刷一次;倒计时提示也跟着走
  const query = useQuery({
    queryKey: ["schedules"],
    queryFn: fetchSchedules,
    refetchInterval: 60_000,
  });
  const now = useNow(60_000);
  const rows = query.data ?? [];

  const soon = rows.filter(
    (row) => row.nextRunAt !== null && row.nextRunAt - now <= SOON_MS && row.nextRunAt >= now,
  ).length;
  const abnormal = rows.filter((row) => row.stale || row.lastError !== null).length;

  const columns: TableColumn<ScheduleRow>[] = [
    {
      key: "task",
      header: "任务",
      width: "26%",
      plain: true,
      render: (row) => (
        <span className={styles.taskCell}>
          <span className={styles.taskTitle}>{row.description}</span>
          <span className={styles.taskSub}>项目 {row.project}</span>
        </span>
      ),
    },
    {
      key: "agent",
      header: "Agent 机器人",
      width: "16%",
      plain: true,
      render: (row) => agentLabel(row),
    },
    {
      key: "frequency",
      header: "频率",
      width: "16%",
      render: (row) => {
        const frequency = frequencyCell(row);
        return (
          <span title={frequency.title ?? frequency.text}>{frequency.text}</span>
        );
      },
    },
    {
      key: "next",
      header: "下次执行",
      width: "18%",
      nowrap: true,
      render: (row) => {
        const at = row.nextRunAt;
        if (at === null) return "—";
        return (
          <span title={`${row.timezone} · ${formatCountdown(at, now)}`}>
            {formatDateTimeIn(at, row.timezone)}
          </span>
        );
      },
    },
    {
      key: "last",
      header: "上次执行",
      width: "16%",
      nowrap: true,
      render: (row) => {
        const at = row.lastRunAt;
        if (at === null) return "—";
        return (
          <span title={formatRelativeTime(at, now)}>{formatDateTimeIn(at, row.timezone)}</span>
        );
      },
    },
    {
      key: "status",
      header: "状态",
      width: "12%",
      nowrap: true,
      render: (row) => {
        const status = statusOf(row, now);
        return (
          <span title={status.title}>
            <Badge tone={status.tone} text={status.text} />
          </span>
        );
      },
    },
    {
      key: "machine",
      header: "机器",
      width: "12%",
      nowrap: true,
      render: (row) => row.machineName,
    },
  ];

  return (
    <div className={styles.page}>
      {query.isPending ? <LoadingState label="加载定时任务…" /> : null}
      {query.isError ? (
        <ErrorState
          message={query.error instanceof ApiError ? query.error.message : "定时任务加载失败"}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {query.data === undefined ? null : (
        <>
          <section className={styles.metrics} aria-label="定时任务指标">
            <StatCard
              icon={<CalendarClock size={16} aria-hidden="true" />}
              label="计划总数"
              value={String(rows.length)}
              sub="周期任务与未触发的一次性任务"
            />
            <StatCard
              icon={<Clock size={16} aria-hidden="true" />}
              label="24 小时内待执行"
              value={String(soon)}
              sub="按各机器自己的时区计算"
            />
            <StatCard
              icon={<TriangleAlert size={16} aria-hidden="true" />}
              label="需要看一眼"
              value={String(abnormal)}
              sub="上次出错或机器离线"
            />
          </section>

          <section className={styles.section}>
            <SectionHeader
              title="定时任务"
              hint="执行机上按计划自动触发的活——谁在跑、什么节奏、下次什么时候"
            />
            {rows.length === 0 ? (
              <EmptyState
                icon={<CalendarClock size={28} aria-hidden="true" />}
                title="还没有定时任务"
                description="执行机上的 cc-connect 配了周期计划后，这里会出现清单。"
              />
            ) : (
              <>
                <div className={styles.tableArea}>
                  <Table columns={columns} rows={rows} rowKey={(row) => row.id} minWidth="880px" />
                </div>
                {/* 窄屏转卡片(03 §8):任务 / 机器人 / 频率 / 状态 */}
                <ul className={styles.cards} aria-label="定时任务卡片">
                  {rows.map((row) => {
                    const status = statusOf(row, now);
                    const frequency = frequencyCell(row);
                    return (
                      <li key={row.id} className={styles.card}>
                        <span className={styles.cardTop}>
                          <span className={styles.cardTitle}>{row.description}</span>
                          <Badge tone={status.tone} text={status.text} />
                        </span>
                        <span className={styles.cardMeta}>
                          <span className={styles.cardMetaLabel}>机器人</span>
                          <span>{agentLabel(row)}</span>
                        </span>
                        <span className={styles.cardMeta}>
                          <span className={styles.cardMetaLabel}>频率</span>
                          <span>{frequency.text}</span>
                        </span>
                        <span className={styles.cardMeta}>
                          <span className={styles.cardMetaLabel}>下次</span>
                          <span>
                            {row.nextRunAt === null
                              ? "—"
                              : formatDateTimeIn(row.nextRunAt, row.timezone)}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>

          <PageFooter>
            只读视图：定时任务由 cc-connect 侧维护，控制台不改频率、不停用、不触发执行。
            <br />
            仅展示已装 aw-node 的执行机上报的计划——未纳管机器与外部运行时的计划不在此列。
          </PageFooter>
        </>
      )}
    </div>
  );
}
