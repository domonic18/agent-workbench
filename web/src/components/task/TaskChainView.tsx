import { Link, useLocation } from "react-router";
import type { TaskChainResult } from "../../api/task-chain.js";
import { CHAIN_RELATION_LABEL } from "../../shared/labels.js";
import styles from "./task-chain.module.css";

export interface TaskChainViewProps {
  chain: TaskChainResult | undefined;
  loading: boolean;
  error: string | null;
  currentTaskId: string;
}

export function TaskChainView({ chain, loading, error, currentTaskId }: TaskChainViewProps) {
  const location = useLocation();

  return (
    <nav className={styles.chain} aria-label="任务来源链">
      <div className={styles.label}>来源链</div>
      {loading ? <p className={styles.loading}>加载来源链…</p> : null}
      {error === null ? null : <p className={styles.chainMissing}>{error}</p>}
      {chain === undefined ? null : (
        <>
          <ol className={styles.chainList}>
            {chain.entries.map((entry, index) => (
              <li key={`${entry.taskId}-${index}`} className={styles.chainItem}>
                {index === 0 ? null : (
                  <span className={styles.chainRelation}>
                    {entry.relation === null
                      ? CHAIN_RELATION_LABEL.unknown
                      : CHAIN_RELATION_LABEL[entry.relation]}
                  </span>
                )}
                {entry.task === null ? (
                  <span className={styles.chainMissing}>
                    上游无任务记录（{entry.taskId}）
                  </span>
                ) : (
                  <Link
                    className={`${styles.chainNode} ${entry.taskId === currentTaskId ? styles.chainCurrent : ""}`}
                    to={`/tasks/${encodeURIComponent(entry.taskId)}${location.search}`}
                  >
                    {entry.task.title}
                  </Link>
                )}
              </li>
            ))}
          </ol>
          {chain.entries.length === 1 ? (
            <p className={styles.hint}>这是链路起点，没有上游任务。</p>
          ) : null}
          {chain.truncated ? (
            <p className={styles.hint}>链路过长或存在环路，已在上游截断。</p>
          ) : null}
        </>
      )}
    </nav>
  );
}
