import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Clock, TriangleAlert } from "lucide-react";
import { ApiError } from "../api/client.js";
import { fetchSchedules } from "../api/schedules.js";
import type { ScheduleRow } from "../api/types.js";
import { Badge } from "../components/ui/Badge.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { ErrorState } from "../components/ui/ErrorState.js";
import { LoadingState } from "../components/ui/LoadingState.js";
import { SectionHeader } from "../components/ui/SectionHeader.js";
import { StatCard } from "../components/ui/StatCard.js";
import { Table, type TableColumn } from "../components/ui/Table.js";
import { describeCron } from "../shared/cron.js";
import { useNow } from "../shared/useNow.js";
import { formatCountdown, formatDateTimeIn, formatRelativeTime } from "../shared/format.js";

const SOON_MS = 24 * 60 * 60 * 1000;

interface StatusView {
  tone: "positive" | "warning" | "danger" | "info" | "muted";
  text: string;
  title?: string;
}

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

export function SchedulesPage() {
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
        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{row.description}</span>
          <span className="text-xs text-muted overflow-hidden text-ellipsis whitespace-nowrap">
            项目 {row.project}
          </span>
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
    <div className="flex flex-col gap-6">
      {query.isPending ? <LoadingState label="加载定时任务…" /> : null}
      {query.isError ? (
        <ErrorState
          message={query.error instanceof ApiError ? query.error.message : "定时任务加载失败"}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {query.data === undefined ? null : (
        <>
          <section className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]" aria-label="定时任务指标">
            <StatCard
              icon={<CalendarClock size={16} aria-hidden="true" />}
              label="计划总数"
              value={String(rows.length)}
            />
            <StatCard
              icon={<Clock size={16} aria-hidden="true" />}
              label="24 小时内待执行"
              value={String(soon)}
            />
            <StatCard
              icon={<TriangleAlert size={16} aria-hidden="true" />}
              label="需要看一眼"
              value={String(abnormal)}
            />
          </section>

          <section className="flex flex-col gap-4">
            <SectionHeader title="定时任务" />
            {rows.length === 0 ? (
              <EmptyState
                icon={<CalendarClock size={28} aria-hidden="true" />}
                title="还没有定时任务"
              />
            ) : (
              <>
                <div className="overflow-x-auto max-md:hidden">
                  <Table columns={columns} rows={rows} rowKey={(row) => row.id} minWidth="880px" />
                </div>
                <ul className="hidden m-0 p-0 list-none max-md:flex max-md:flex-col max-md:gap-3" aria-label="定时任务卡片">
                  {rows.map((row) => {
                    const status = statusOf(row, now);
                    const frequency = frequencyCell(row);
                    return (
                      <li key={row.id} className="flex flex-col gap-2 p-4 border border-border rounded-lg bg-surface">
                        <span className="flex items-start justify-between gap-3">
                          <span className="text-md font-semibold break-words">{row.description}</span>
                          <Badge tone={status.tone} text={status.text} />
                        </span>
                        <span className="flex flex-wrap items-baseline gap-2 text-sm">
                          <span className="text-xs text-muted">机器人</span>
                          <span>{agentLabel(row)}</span>
                        </span>
                        <span className="flex flex-wrap items-baseline gap-2 text-sm">
                          <span className="text-xs text-muted">频率</span>
                          <span>{frequency.text}</span>
                        </span>
                        <span className="flex flex-wrap items-baseline gap-2 text-sm">
                          <span className="text-xs text-muted">下次</span>
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
        </>
      )}
    </div>
  );
}
