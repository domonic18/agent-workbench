import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
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
import { agentMentionLabel, agentNameMap } from "../../shared/agent-label.js";
import { useNow } from "../../shared/useNow.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { Dialog } from "../ui/Dialog.js";
import { TaskA2aThreads } from "./TaskA2aThreads.js";
import { TaskChainView } from "./TaskChainView.js";
import { TaskDetailSummary } from "./TaskDetailSummary.js";
import { TaskTimeline } from "./TaskTimeline.js";
import styles from "./task-drawer.module.css";

export interface TaskDrawerProps {
  taskId: string;
  onClose: () => void;
  /** 跳到该任务所属的工作事项详情 */
  onOpenWorkItem: (workItemId: string) => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function TaskDrawer({ taskId, onClose, onOpenWorkItem }: TaskDrawerProps) {
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

  const agentNames = useMemo(() => agentNameMap(agents.data ?? []), [agents.data]);

  const assignerName =
    task === undefined
      ? taskId
      : agentMentionLabel(task.assigner, agentNames, task.assigner_label);
  const assigneeName =
    task === undefined
      ? taskId
      : agentMentionLabel(task.assignee, agentNames, task.assignee_label);

  return (
    <Dialog
      variant="drawer"
      ariaLabel="任务详情"
      onClose={onClose}
      title={task === undefined ? taskId : `${task.id} · ${task.title}`}
      description={
        task === undefined
          ? "加载中…"
          : `${assignerName} → ${assigneeName} · 第 ${task.round} 轮 · ${
              TASK_STATUS_LABEL[task.status]
            }`
      }
      headerExtra={<Badge tone={REALTIME_TONE[realtime]} text={REALTIME_LABEL[realtime]} />}
    >
      {detail.isPending ? <p className={styles.loading}>加载中…</p> : null}
      {detail.isError ? (
        <div className={styles.errorBox} role="alert">
          <span>{errorMessage(detail.error, "任务详情加载失败")}</span>
          <Button size="sm" variant="secondary" onClick={() => void detail.refetch()}>
            重试
          </Button>
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
            onOpenWorkItem={onOpenWorkItem}
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
              <Button size="sm" variant="secondary" onClick={() => void events.refetch()}>
                重试
              </Button>
            </div>
          ) : (
            <TaskTimeline
              events={taskEvents}
              agentNames={agentNames}
              hasMore={events.hasNextPage}
              loadingMore={events.isFetchingNextPage}
              onLoadMore={() => void events.fetchNextPage()}
            />
          )}
        </>
      )}
    </Dialog>
  );
}
