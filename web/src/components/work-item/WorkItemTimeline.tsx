import { useInfiniteQuery } from "@tanstack/react-query";
import { ApiError } from "../../api/client.js";
import { fetchWorkItemEvents, type WorkItemEvent } from "../../api/work-items.js";
import { formatDateTime, formatRelativeTime } from "../../shared/format.js";
import { WORK_ITEM_EVENT_LABEL } from "../../shared/labels.js";
import { Button } from "../ui/Button.js";
import { JsonBlock } from "./JsonBlock.js";

export interface WorkItemTimelineProps {
  workItemId: string;
}

function eventLabel(kind: string): string {
  return WORK_ITEM_EVENT_LABEL[kind] ?? kind;
}

function EventRow({ event }: { event: WorkItemEvent }) {
  return (
    <li className="rounded-md border border-border bg-surface-2 p-3">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-foreground">{eventLabel(event.kind)}</span>
        <span className="font-mono text-xs text-subtle">#{event.seq}</span>
      </div>
      <div className="mt-1 text-xs text-muted">
        {formatDateTime(event.occurredAt)}（{formatRelativeTime(event.occurredAt)}）
      </div>
      <div className="mt-2 text-xs">
        <JsonBlock value={event.payload} empty="无附加内容" />
      </div>
    </li>
  );
}

export function WorkItemTimeline({ workItemId }: WorkItemTimelineProps) {
  const events = useInfiniteQuery({
    queryKey: ["work-item", workItemId, "events"],
    queryFn: ({ pageParam }) => fetchWorkItemEvents(workItemId, pageParam, 200),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.nextCursor === null ? undefined : last.nextCursor),
  });

  const items: WorkItemEvent[] = (events.data?.pages.flatMap((page) => page.items) ?? []).reverse();

  return (
    <section className="mt-6 border-t border-line-soft pt-4" aria-label="永久时间线">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h3 className="m-0 text-md font-bold text-foreground">永久时间线</h3>
      </div>

      {events.isPending ? <p className="text-sm text-muted">加载中…</p> : null}

      {events.isError ? (
        <div
          className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger"
          role="alert"
        >
          <span>
            {events.error instanceof ApiError ? events.error.message : "事件加载失败"}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void events.refetch()}>
            重试
          </Button>
        </div>
      ) : null}

      {items.length === 0 && !events.isPending && !events.isError ? (
        <p className="text-sm text-muted">暂无事件记录</p>
      ) : null}

      {items.length === 0 ? null : (
        <ul className="m-0 mb-3 flex list-none flex-col gap-2 p-0">
          {items.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ul>
      )}

      {events.hasNextPage ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={events.isFetchingNextPage}
          onClick={() => void events.fetchNextPage()}
        >
          {events.isFetchingNextPage ? "加载中…" : "加载更多事件"}
        </Button>
      ) : null}
    </section>
  );
}
