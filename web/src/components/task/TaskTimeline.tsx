import type { TaskEventDto } from "../../api/tasks.js";
import { formatDateTime } from "../../shared/format.js";
import { TASK_EVENT_LABEL } from "../../shared/labels.js";
import { describeTaskEvent } from "./task-event.js";
import styles from "./task-timeline.module.css";

export interface TaskTimelineProps {
  events: readonly TaskEventDto[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export function TaskTimeline({ events, hasMore, loadingMore, onLoadMore }: TaskTimelineProps) {
  return (
    <section className={styles.section} aria-label="事件时间线">
      <h3 className={styles.sectionTitle}>事件时间线</h3>
      {events.length === 0 ? (
        <p className={styles.muted}>暂无事件。</p>
      ) : (
        <ol className={styles.timeline}>
          {events.map((event) => (
            <li key={event.id} className={styles.timelineItem}>
              <span className={styles.seq}>#{event.seq}</span>
              <div className={styles.timelineBody}>
                <div className={styles.eventTitle}>
                  <span className={styles.kind}>{TASK_EVENT_LABEL[event.kind]}</span>
                  <span className={styles.time}>{formatDateTime(event.occurred_at)}</span>
                </div>
                <div className={styles.desc}>{describeTaskEvent(event)}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {hasMore ? (
        <button
          type="button"
          className={styles.more}
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? "加载中…" : "加载更多事件"}
        </button>
      ) : null}
    </section>
  );
}
