import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ApiError } from "../../api/client.js";
import { fetchAgentTimeline, type AgentTimelineEntry } from "../../api/identity.js";
import type { AgentRosterSummary } from "../../api/identity.js";
import { hasCollector } from "../../shared/agent-label.js";
import { formatDateTime } from "../../shared/format.js";
import { timelineKindMeta, TIMELINE_FILTER_OPTIONS } from "../../shared/timeline-kind.js";
import { Button } from "../ui/Button.js";
import { ChipGroup } from "../ui/Chip.js";
import { EmptyState } from "../ui/EmptyState.js";
import { timelinePayloadView } from "./timeline-payload.js";
import styles from "./agent-timeline.module.css";

const PAGE_SIZE = 50;

export interface AgentTimelineProps {
  agent: AgentRosterSummary;
}

interface RunGroup {
  runId: string;
  runProject: string;
  runMachine: string;
  entries: AgentTimelineEntry[];
}

/** 按 run 分组：一次运行 = 一个会话，组内按时间正序 */
function groupByRun(entries: readonly AgentTimelineEntry[]): RunGroup[] {
  const groups = new Map<string, RunGroup>();
  for (const entry of entries) {
    const existing = groups.get(entry.runId);
    if (existing === undefined) {
      groups.set(entry.runId, {
        runId: entry.runId,
        runProject: entry.runProject,
        runMachine: entry.runMachine,
        entries: [entry],
      });
      continue;
    }
    existing.entries.push(entry);
  }
  return [...groups.values()];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** Agent 的对话工作流记录：按会话分组的事件流 */
export function AgentTimeline({ agent }: AgentTimelineProps) {
  const [filter, setFilter] = useState("all");
  const collected = hasCollector(agent);

  const query = useInfiniteQuery({
    queryKey: ["agent", agent.id, "timeline"],
    queryFn: ({ pageParam }) =>
      fetchAgentTimeline(agent.id, {
        limit: PAGE_SIZE,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: collected,
  });

  // 页是「最近一页 → 更早一页」，翻平成时间正序要把页序倒过来
  const entries = useMemo(() => {
    const pages = query.data?.pages ?? [];
    return pages
      .slice()
      .reverse()
      .flatMap((page) => page.items);
  }, [query.data]);

  const groups = useMemo(() => {
    const filtered =
      filter === "all"
        ? entries
        : entries.filter((entry) => entry.kind === filter);
    return groupByRun(filtered);
  }, [entries, filter]);

  if (!collected) {
    return (
      <EmptyState
        title="未接入过程数据"
        description="该 Agent 不是由本机 aw-node 采集的运行时，控制台拿不到它的对话与工具调用记录。"
      />
    );
  }

  if (query.isPending) {
    return <p className={styles.muted}>加载中…</p>;
  }

  if (query.isError) {
    return (
      <div className={styles.error} role="alert">
        <span>{errorMessage(query.error, "对话记录加载失败")}</span>
        <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.filterBar}>
        <ChipGroup
          label="按事件类型筛选"
          options={TIMELINE_FILTER_OPTIONS}
          value={filter}
          onValueChange={setFilter}
        />
        <span className={styles.muted}>共 {entries.length} 条记录</span>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title={entries.length === 0 ? "还没有对话记录" : "没有匹配的事件"}
          description={
            entries.length === 0
              ? "该 Agent 还没有上报过会话过程数据。"
              : "换个类型筛选再试。"
          }
        />
      ) : (
        <ol className={styles.groups}>
          {groups.map((group) => {
            const first = group.entries[0];
            const last = group.entries[group.entries.length - 1];
            return (
              <li key={group.runId} className={styles.group}>
                <div className={styles.groupHeader}>
                  <span className={styles.groupTitle}>
                    {group.runProject} · {group.runMachine}
                  </span>
                  <span className={styles.groupMeta}>
                    {first === undefined || last === undefined
                      ? ""
                      : formatDateTime(first.occurredAt)}
                    {first !== undefined && last !== undefined && first.id !== last.id
                      ? ` → ${formatDateTime(last.occurredAt)}`
                      : ""}
                  </span>
                </div>
                <ul className={styles.events}>
                  {group.entries.map((entry) => {
                    const meta = timelineKindMeta(entry.kind);
                    const Icon = meta.Icon;
                    const view = timelinePayloadView(entry.kind, entry.payload);
                    return (
                      <li key={entry.id} className={styles.event}>
                        <span className={styles.eventIcon} aria-hidden="true">
                          <Icon size={14} />
                        </span>
                        <div className={styles.eventBody}>
                          <div className={styles.eventHead}>
                            <span className={styles.eventKind}>{meta.label}</span>
                            <span className={styles.eventTime}>
                              {formatDateTime(entry.occurredAt)}
                            </span>
                            {view.meta === undefined ? null : (
                              <span className={styles.eventMeta}>{view.meta}</span>
                            )}
                          </div>
                          <pre
                            className={`${styles.eventText} ${view.code === true ? styles.eventCode : ""} ${
                              view.error === true ? styles.eventError : ""
                            }`}
                          >
                            {view.body}
                          </pre>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      )}

      {query.hasNextPage ? (
        <div className={styles.loadMore}>
          <Button
            size="sm"
            variant="secondary"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? "加载中…" : "加载更早的记录"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
