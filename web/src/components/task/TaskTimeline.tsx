import type { TaskEventDto } from "../../api/tasks.js";
import { formatDateTime } from "../../shared/format.js";
import { TASK_EVENT_LABEL } from "../../shared/labels.js";
import { Button } from "../ui/Button.js";
import { describeTaskEvent } from "./task-event.js";
import { muted as sharedMuted } from "./shared.js";

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
    <section
      className="mt-5 border-t border-line-soft pt-4"
      aria-label="事件流"
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="m-0 text-sm font-bold text-foreground">事件流</h3>
        <span className="ml-auto text-xs text-subtle">
          最近 {events.length} 条{hasMore ? " · 还有更早事件" : ""}
        </span>
      </div>
      {events.length === 0 ? (
        <p className={sharedMuted}>暂无事件。</p>
      ) : (
        <ol className="m-0 list-none p-0">
          {ordered.map((event) => (
            <li
              key={event.id}
              className="relative flex flex-wrap items-baseline gap-0 py-1 pl-4 text-xs leading-[1.6] text-text-secondary before:absolute before:top-3 before:left-0 before:h-1 before:w-1 before:rounded-full before:bg-border before:content-[''] first:before:bg-accent"
            >
              <span className="flex-none text-xs text-muted after:content-['_·']">
                {TASK_EVENT_LABEL[event.kind]}
              </span>
              <span className="flex-none text-xs text-subtle after:content-['_·']">
                {formatDateTime(event.occurred_at)}
              </span>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {describeTaskEvent(event, agentNames)}
              </span>
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
