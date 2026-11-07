import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../api/client.js";
import { fetchTasks } from "../../api/tasks.js";
import { formatRelativeTime } from "../../shared/format.js";
import { TASK_STAGE_LABEL, TASK_STATUS_LABEL, TASK_STATUS_TONE } from "../../shared/labels.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
import styles from "./agents.module.css";

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
    return <p className={styles.muted}>加载中…</p>;
  }

  if (query.isError) {
    return (
      <div className={styles.error} role="alert">
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
    <ul className={styles.taskList}>
      {tasks.map((task) => (
        <li key={task.id}>
          <button
            type="button"
            className={styles.taskRow}
            onClick={() => onOpenTask(task.id)}
          >
            <span className={styles.taskRowTitle}>{task.title}</span>
            <span className={styles.taskRowMeta}>
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
