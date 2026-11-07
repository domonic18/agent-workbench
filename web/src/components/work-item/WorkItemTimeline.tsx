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

/** 事件 kind 是自由文本,查不到映射时回退原值 */
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

/**
 * 永久时间线。
 * 服务端按 `seq > cursor` 升序返回,cursor=0 给出最早的一批,每页往后推进,
 * 所以按钮是「加载更多事件」而不是「加载更早」。
 */
export function WorkItemTimeline({ workItemId }: WorkItemTimelineProps) {
  const events = useInfiniteQuery({
    queryKey: ["work-item", workItemId, "events"],
    queryFn: ({ pageParam }) => fetchWorkItemEvents(workItemId, pageParam, 200),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.nextCursor === null ? undefined : last.nextCursor),
  });

  // 服务端按 seq 升序给,展示倒序:最新的事件在最上面
  const items: WorkItemEvent[] = (events.data?.pages.flatMap((page) => page.items) ?? []).reverse();

  return (
    <section className={styles.timeline} aria-label="永久时间线">
      <div className={styles.head}>
        <h3 className={styles.title}>永久时间线</h3>
        <span className={styles.hint}>最新在前，摘要不可用时仍能追溯来源</span>
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
