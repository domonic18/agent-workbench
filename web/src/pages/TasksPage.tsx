import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Suspense, useMemo } from "react";
import { Outlet, useLocation } from "react-router";
import { ApiError } from "../api/client.js";
import { fetchAgents } from "../api/identity.js";
import { fetchTasks, readTaskFilters, type TaskFilters } from "../api/tasks.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { TaskFiltersForm } from "../components/task/TaskFilters.js";
import { TaskTable } from "../components/task/TaskTable.js";
import { useNow } from "../shared/useNow.js";
import styles from "../components/task/task-list.module.css";

function toQuery(filters: TaskFilters) {
  return {
    ...(filters.status === null ? {} : { status: filters.status }),
    ...(filters.project === null ? {} : { project: filters.project }),
    ...(filters.assignee === null ? {} : { assignee: filters.assignee }),
  };
}

export function TasksPage() {
  const location = useLocation();
  const now = useNow(30_000);
  const filters = readTaskFilters(new URLSearchParams(location.search));
  const query = toQuery(filters);

  const tasksQuery = useInfiniteQuery({
    queryKey: ["tasks", filters.status ?? "", filters.project ?? "", filters.assignee ?? ""],
    queryFn: ({ pageParam }) =>
      fetchTasks({ ...query, ...(pageParam === null ? {} : { cursor: pageParam }) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    retry: (count, caught) =>
      !(caught instanceof ApiError && caught.status === 401) && count < 2,
  });
  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });

  const agentNames = useMemo(
    () => new Map((agentsQuery.data ?? []).map((agent) => [agent.id, agent.displayName])),
    [agentsQuery.data],
  );
  const tasks = tasksQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const hasFilters =
    filters.status !== null || filters.project !== null || filters.assignee !== null;

  return (
    <div className={styles.page}>
      <TaskFiltersForm />

      {tasksQuery.isPending ? <p className={styles.loading}>加载中…</p> : null}

      {tasksQuery.isError ? (
        <div className={styles.errorBox} role="alert">
          <span>
            {tasksQuery.error instanceof ApiError
              ? tasksQuery.error.message
              : "任务列表加载失败"}
          </span>
          <button
            type="button"
            className={styles.retry}
            onClick={() => void tasksQuery.refetch()}
          >
            重试
          </button>
        </div>
      ) : null}

      {!tasksQuery.isPending && !tasksQuery.isError ? (
        tasks.length === 0 ? (
          <EmptyState
            title={hasFilters ? "没有匹配的任务" : "暂无任务记录"}
            description={
              hasFilters
                ? "调整筛选条件后再试。"
                : "Agent 尚未上报任务；未建单的工作不会出现在这里。"
            }
          />
        ) : (
          <TaskTable
            tasks={tasks}
            agentNames={agentNames}
            search={location.search}
            now={now}
          />
        )
      ) : null}

      {tasksQuery.hasNextPage ? (
        <button
          type="button"
          className={styles.more}
          disabled={tasksQuery.isFetchingNextPage}
          onClick={() => void tasksQuery.fetchNextPage()}
        >
          {tasksQuery.isFetchingNextPage ? "加载中…" : "加载更多"}
        </button>
      ) : null}

      <p className={styles.note}>
        仅显示已自报的任务——Agent 判断不需要建单的活不会出现在这里。
      </p>

      {/* 详情抽屉独立分包,加载时保留列表视图不闪烁 */}
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
    </div>
  );
}
