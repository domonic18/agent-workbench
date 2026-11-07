import type { TaskEventDto } from "../../api/tasks.js";
import { formatDateTime } from "../../shared/format.js";
import { TASK_EVENT_LABEL } from "../../shared/labels.js";
import { Button } from "../ui/Button.js";
import { describeTaskEvent } from "./task-event.js";
import styles from "./task-timeline.module.css";

export interface TaskTimelineProps {
  events: readonly TaskEventDto[];
  /** Agent id → 机器人名;事件正文里的下发人用它替掉裸 id */
  agentNames: ReadonlyMap<string, string>;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export function TaskTimeline({
  events,
  agentNames,
  hasMore,
  loadingMore,
  onLoadMore,
}: TaskTimelineProps) {
  const ordered = [...events].reverse();
  return (
    <section className={styles.section} aria-label="事件流">
      <div className={styles.header}>
        <h3 className={styles.sectionTitle}>事件流</h3>
        <span className={styles.caption}>
          最近 {events.length} 条{hasMore ? " · 还有更早事件" : ""}
        </span>
      </div>
      {events.length === 0 ? (
        <p className={styles.muted}>暂无事件。</p>
      ) : (
        <ol className={styles.timeline}>
          {ordered.map((event) => (
            <li key={event.id} className={styles.timelineItem}>
              <span className={styles.kind}>{TASK_EVENT_LABEL[event.kind]}</span>
              <span className={styles.time}>{formatDateTime(event.occurred_at)}</span>
              <span className={styles.desc}>{describeTaskEvent(event, agentNames)}</span>
            </li>
          ))}
        </ol>
      )}
      {hasMore ? (
        <Button size="sm" loading={loadingMore} onClick={onLoadMore}>
          加载更多事件
        </Button>
      ) : null}
    </section>
  );
}
