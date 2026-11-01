import type { TaskDto, TaskEventDto } from "../../api/tasks.js";
import { formatDateTime, formatDuration } from "../../shared/format.js";
import { TASK_EVENT_LABEL } from "../../shared/labels.js";
import { describeTaskEvent, latestEventReason } from "./task-event.js";
import styles from "./task-drawer.module.css";

export interface TaskFocusPanelProps {
  task: TaskDto;
  events: readonly TaskEventDto[];
  now: number;
}

const TERMINAL_STATUSES: readonly TaskDto["status"][] = ["done", "cancelled"];

export function TaskFocusPanel({ task, events, now }: TaskFocusPanelProps) {
  const last = events.at(-1);
  const terminal = TERMINAL_STATUSES.includes(task.status);
  const reason = task.status === "blocked" ? latestEventReason(events) : null;
  const since = last?.occurred_at ?? task.updated_at;

  return (
    <section className={styles.focus} aria-label="任务卡点">
      <h3 className={styles.sectionTitle}>卡在哪一环</h3>
      <dl className={styles.focusGrid}>
        <div className={styles.focusItem}>
          <dt className={styles.focusLabel}>最后事件</dt>
          <dd className={styles.focusValue}>
            {last === undefined
              ? "暂无事件"
              : `#${last.seq} ${TASK_EVENT_LABEL[last.kind]} · ${formatDateTime(last.occurred_at)}`}
          </dd>
        </div>
        <div className={styles.focusItem}>
          <dt className={styles.focusLabel}>阻塞原因</dt>
          <dd className={styles.focusValue}>
            {task.status !== "blocked"
              ? "当前未阻塞"
              : reason ?? "未记录原因（事件 payload 无 reason）"}
          </dd>
        </div>
        <div className={styles.focusItem}>
          <dt className={styles.focusLabel}>已等待</dt>
          <dd className={styles.focusValue}>
            {terminal ? "已收尾" : formatDuration(now - since)}
          </dd>
        </div>
      </dl>
      {last === undefined ? null : <p className={styles.hint}>{describeTaskEvent(last)}</p>}
    </section>
  );
}
