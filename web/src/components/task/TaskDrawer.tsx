import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ApiError } from "../../api/client.js";
import { fetchAgents } from "../../api/identity.js";
import { useRealtimeStream } from "../../api/stream.js";
import { buildTaskChain } from "../../api/task-chain.js";
import {
  fetchTask,
  fetchTaskA2a,
  fetchTaskEvents,
  type TaskEventDto,
} from "../../api/tasks.js";
import {
  REALTIME_LABEL,
  REALTIME_TONE,
  TASK_STATUS_LABEL,
} from "../../shared/labels.js";
import { useNow } from "../../shared/useNow.js";
import { StatusBadge } from "../data/StatusBadge.js";
import { TaskA2aThreads } from "./TaskA2aThreads.js";
import { TaskChainView } from "./TaskChainView.js";
import { TaskDetailSummary } from "./TaskDetailSummary.js";
import { TaskTimeline } from "./TaskTimeline.js";
import styles from "./task-drawer.module.css";

export interface TaskDrawerProps {
  taskId: string;
  onClose: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function TaskDrawer({ taskId, onClose }: TaskDrawerProps) {
  const now = useNow(30_000);
  const realtime = useRealtimeStream([`task:${taskId}`]);

  const detail = useQuery({
    queryKey: ["task", taskId, "detail"],
    queryFn: () => fetchTask(taskId),
    retry: (count, caught) =>
      !(caught instanceof ApiError && caught.status === 401) && count < 2,
  });
  const events = useInfiniteQuery({
    queryKey: ["task", taskId, "events"],
    queryFn: ({ pageParam }) => fetchTaskEvents(taskId, pageParam, 200),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.nextCursor === null ? undefined : last.nextCursor),
  });
  const a2a = useQuery({
    queryKey: ["task", taskId, "a2a"],
    queryFn: () => fetchTaskA2a(taskId),
    retry: (count, caught) =>
      !(caught instanceof ApiError && caught.status === 401) && count < 2,
  });
  const agents = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });

  const task = detail.data?.task;
  const taskEvents: TaskEventDto[] =
    events.data?.pages.flatMap((page) => page.items) ?? [];
  const lastSeq = taskEvents.at(-1)?.seq ?? -1;
  const chain = useQuery({
    queryKey: ["task", taskId, "chain", task?.parent_task_id ?? "", lastSeq],
    enabled: task !== undefined && events.data !== undefined,
    queryFn: () => {
      if (task === undefined) {
        throw new Error("任务尚未加载");
      }
      return buildTaskChain(task, taskEvents);
    },
  });

  const agentNames = useMemo(
    () => new Map((agents.data ?? []).map((agent) => [agent.id, agent.displayName])),
    [agents.data],
  );

  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const assigneeName =
    task === undefined ? taskId : agentNames.get(task.assignee) ?? task.assignee;

  return (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label="任务详情"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.drawerHeader}>
          <div className={styles.drawerHeading}>
            <h2 className={styles.drawerTitle}>
              {task === undefined ? taskId : `${task.id} · ${task.title}`}
            </h2>
            <div className={styles.drawerMeta}>
              {task === undefined ? (
                <span className={styles.drawerSubtitle}>加载中…</span>
              ) : (
                <span className={styles.drawerSubtitle}>
                  {task.assigner} → {assigneeName} · 第 {task.round} 轮 ·{" "}
                  {TASK_STATUS_LABEL[task.status]}
                </span>
              )}
              <StatusBadge tone={REALTIME_TONE[realtime]} text={REALTIME_LABEL[realtime]} />
            </div>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className={styles.drawerBody}>
          {detail.isPending ? <p className={styles.loading}>加载中…</p> : null}
          {detail.isError ? (
            <div className={styles.errorBox} role="alert">
              <span>{errorMessage(detail.error, "任务详情加载失败")}</span>
              <button type="button" className={styles.retry} onClick={() => void detail.refetch()}>
                重试
              </button>
            </div>
          ) : null}

          {detail.data === undefined ? null : (
            <>
              <TaskDetailSummary
                task={detail.data.task}
                capabilities={detail.data.capabilities}
                tokens={detail.data.tokens}
                events={taskEvents}
                agentNames={agentNames}
                now={now}
              />

              <section className={styles.inlineSection} aria-label="轮次链">
                <div className={styles.sectionHeading}>
                  <h3 className={styles.inlineTitle}>轮次链</h3>
                  <span className={styles.sectionHint}>A2A 内容只在这里，不进群</span>
                </div>
                <TaskChainView
                  chain={chain.data}
                  loading={chain.isPending}
                  error={
                    chain.isError ? errorMessage(chain.error, "来源链加载失败") : null
                  }
                  currentTaskId={detail.data.task.id}
                />
                <TaskA2aThreads
                  threads={a2a.data?.threads ?? []}
                  loading={a2a.isPending}
                  error={a2a.isError ? errorMessage(a2a.error, "A2A 线程加载失败") : null}
                  agentNames={agentNames}
                />
              </section>

              {events.isError ? (
                <div className={styles.errorBox} role="alert">
                  <span>{errorMessage(events.error, "事件加载失败")}</span>
                  <button
                    type="button"
                    className={styles.retry}
                    onClick={() => void events.refetch()}
                  >
                    重试
                  </button>
                </div>
              ) : (
                <TaskTimeline
                  events={taskEvents}
                  hasMore={events.hasNextPage}
                  loadingMore={events.isFetchingNextPage}
                  onLoadMore={() => void events.fetchNextPage()}
                />
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
