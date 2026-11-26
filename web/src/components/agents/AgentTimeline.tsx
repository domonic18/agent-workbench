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
import { cn } from "../../lib/utils.js";

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
      />
    );
  }

  if (query.isPending) {
    return <p className="text-muted text-xs">加载中…</p>;
  }

  if (query.isError) {
    return (
      <div className="flex items-center gap-3 text-danger text-sm" role="alert">
        <span>{errorMessage(query.error, "对话记录加载失败")}</span>
        <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <ChipGroup
          label="按事件类型筛选"
          options={TIMELINE_FILTER_OPTIONS}
          value={filter}
          onValueChange={setFilter}
        />
        <span className="text-muted text-xs">共 {entries.length} 条记录</span>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title={entries.length === 0 ? "还没有对话记录" : "没有匹配的事件"}
        />
      ) : (
        <ol className="flex flex-col gap-4 m-0 p-0 list-none">
          {groups.map((group) => {
            const first = group.entries[0];
            const last = group.entries[group.entries.length - 1];
            return (
              <li key={group.runId} className="border border-border rounded-md bg-surface-2 overflow-hidden">
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 border-b border-line-soft bg-surface-3">
                  <span className="text-sm font-semibold text-foreground">
                    {group.runProject} · {group.runMachine}
                  </span>
                  <span className="text-xs text-muted tabular-nums">
                    {first === undefined || last === undefined
                      ? ""
                      : formatDateTime(first.occurredAt)}
                    {first !== undefined && last !== undefined && first.id !== last.id
                      ? ` → ${formatDateTime(last.occurredAt)}`
                      : ""}
                  </span>
                </div>
                <ul className="flex flex-col m-0 px-3 py-2 list-none">
                  {group.entries.map((entry) => {
                    const meta = timelineKindMeta(entry.kind);
                    const Icon = meta.Icon;
                    const view = timelinePayloadView(entry.kind, entry.payload);
                    return (
                      <li key={entry.id} className="flex gap-3 py-2 border-t border-line-soft first:border-t-0">
                        <span className="inline-flex items-center justify-center flex-none w-icon-tile h-icon-tile rounded-sm bg-surface-3 text-text-secondary" aria-hidden="true">
                          <Icon size={14} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-xs font-semibold text-foreground">{meta.label}</span>
                            <span className="text-xs text-muted">
                              {formatDateTime(entry.occurredAt)}
                            </span>
                            {view.meta === undefined ? null : (
                              <span className="text-xs text-muted">{view.meta}</span>
                            )}
                          </div>
                          <pre
                            className={cn(
                              "mt-1 [font-family:inherit] text-sm leading-[1.6] text-foreground whitespace-pre-wrap [overflow-wrap:anywhere]",
                              view.code === true &&
                                "px-2 py-2 rounded-sm bg-surface-3 font-mono text-xs text-text-secondary",
                              view.error === true && "text-danger",
                            )}
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
        <div className="flex justify-center mt-4">
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
