import { useInfiniteQuery } from "@tanstack/react-query";
import { ApiError } from "../../api/client.js";
import { fetchWorkItemEvents, type WorkItemEvent } from "../../api/work-items.js";
import { formatDateTime, formatRelativeTime } from "../../shared/format.js";
import { WORK_ITEM_EVENT_LABEL } from "../../shared/labels.js";
import { Button } from "../ui/Button.js";
import { JsonBlock } from "./JsonBlock.js";
import styles from "./work-item-timeline.module.css";

export interface WorkItemTimelineProps {
  workItemId: string;
}

function eventLabel(kind: string): string {
  return WORK_ITEM_EVENT_LABEL[kind] ?? kind;
}

function EventRow({ event }: { event: WorkItemEvent }) {
  return (
    <li className={styles.event}>
      <div className={styles.eventHead}>
        <span className={styles.eventKind}>{eventLabel(event.kind)}</span>
        <span className={styles.eventSeq}>#{event.seq}</span>
      </div>
      <div className={styles.eventTime}>
        {formatDateTime(event.occurredAt)}（{formatRelativeTime(event.occurredAt)}）
      </div>
      <div className={styles.eventPayload}>
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
    <section className={styles.timeline} aria-label="永久时间线">
      <div className={styles.head}>
        <h3 className={styles.title}>永久时间线</h3>
      </div>

      {events.isPending ? <p className={styles.muted}>加载中…</p> : null}

      {events.isError ? (
        <div className={styles.errorBox} role="alert">
          <span>
            {events.error instanceof ApiError ? events.error.message : "事件加载失败"}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void events.refetch()}>
            重试
          </Button>
        </div>
      ) : null}

      {items.length === 0 && !events.isPending && !events.isError ? (
        <p className={styles.muted}>暂无事件记录</p>
      ) : null}

      {items.length === 0 ? null : (
        <ul className={styles.events}>
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
