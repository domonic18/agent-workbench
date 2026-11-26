import { Link, useLocation } from "react-router";
import type { TaskChainResult } from "../../api/task-chain.js";
import { cn } from "../../lib/utils.js";
import { CHAIN_RELATION_LABEL } from "../../shared/labels.js";
import { hint as sharedHint, loading as sharedLoading } from "./shared.js";

export interface TaskChainViewProps {
  chain: TaskChainResult | undefined;
  loading: boolean;
  error: string | null;
  currentTaskId: string;
}

const chainNode =
  "text-text-secondary no-underline hover:text-accent hover:underline max-md:inline-flex max-md:items-center max-md:min-h-touch";

const chainCurrent = "text-accent font-semibold";

export function TaskChainView({ chain, loading, error, currentTaskId }: TaskChainViewProps) {
  const location = useLocation();

  return (
    <nav className="m-0 mb-2" aria-label="任务来源链">
      {loading ? <p className={sharedLoading}>加载来源链…</p> : null}
      {error === null ? null : <p className="text-warning text-xs">{error}</p>}
      {chain === undefined ? null : (
        <>
          <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-xs">
            {chain.entries.map((entry, index) => (
              <li key={`${entry.taskId}-${index}`} className="flex items-center gap-1">
                {index === 0 ? null : (
                  <span className="rounded-full bg-chip-bg px-2 text-2xs text-muted">
                    {entry.relation === null
                      ? CHAIN_RELATION_LABEL.unknown
                      : CHAIN_RELATION_LABEL[entry.relation]}
                  </span>
                )}
                {entry.task === null ? (
                  <span className="text-xs text-warning">
                    上游无任务记录（{entry.taskId}）
                  </span>
                ) : (
                  <Link
                    className={cn(chainNode, entry.taskId === currentTaskId && chainCurrent)}
                    to={`/tasks/${encodeURIComponent(entry.taskId)}${location.search}`}
                  >
                    {entry.task.title}
                  </Link>
                )}
              </li>
            ))}
          </ol>
          {chain.entries.length === 1 ? (
            <p className={sharedHint}>这是链路起点，没有上游任务。</p>
          ) : null}
          {chain.truncated ? (
            <p className={sharedHint}>链路过长或存在环路，已在上游截断。</p>
          ) : null}
        </>
      )}
    </nav>
  );
}
