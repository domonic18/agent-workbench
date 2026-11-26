import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../api/client.js";
import { fetchTasks } from "../../api/tasks.js";
import { formatRelativeTime } from "../../shared/format.js";
import { TASK_STAGE_LABEL, TASK_STATUS_LABEL, TASK_STATUS_TONE } from "../../shared/labels.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";

export interface AgentTaskPanelProps {
  agentId: string;
  /** 点任务行跳到任务详情 */
  onOpenTask: (taskId: string) => void;
}

const LIMIT = 20;

/** 任务分区：该 Agent 名下最近的任务 */
export function AgentTaskPanel({ agentId, onOpenTask }: AgentTaskPanelProps) {
  const query = useQuery({
    queryKey: ["tasks", { assignee: agentId, limit: LIMIT }],
    queryFn: () => fetchTasks({ assignee: agentId, limit: LIMIT }),
  });

  if (query.isPending) {
    return <p className="text-muted">加载中…</p>;
  }

  if (query.isError) {
    return (
      <div className="mt-3 text-xs text-danger" role="alert">
        <span>{query.error instanceof ApiError ? query.error.message : "任务加载失败"}</span>
        <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
          重试
        </Button>
      </div>
    );
  }

  const tasks = query.data?.items ?? [];
  if (tasks.length === 0) {
    return (
      <EmptyState title="还没有任务" description="该 Agent 名下还没有任务记录。" />
    );
  }

  return (
    <ul className="flex flex-col gap-2 m-0 p-0 list-none">
      {tasks.map((task) => (
        <li key={task.id}>
          <button
            type="button"
            className="flex flex-col gap-1 w-full p-3 border border-border rounded-md bg-surface-2 text-inherit [font:inherit] text-left cursor-pointer enabled:hover:border-accent-border"
            onClick={() => onOpenTask(task.id)}
          >
            <span className="text-sm font-semibold text-foreground">{task.title}</span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge
                tone={TASK_STATUS_TONE[task.status]}
                text={TASK_STATUS_LABEL[task.status]}
              />
              <span>{TASK_STAGE_LABEL[task.stage]}</span>
              <span>{formatRelativeTime(task.updated_at)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
