import { Link, useNavigate } from "react-router";
import type { TaskDto } from "../../api/tasks.js";
import {
  formatCompactDuration,
  formatDuration,
  formatExactTokens,
  formatTokens,
} from "../../shared/format.js";
import { TASK_ORIGIN_LABEL, TASK_STAGE_LABEL, TASK_STATUS_LABEL, TASK_STATUS_TONE } from "../../shared/labels.js";
import { StatusBadge } from "../data/StatusBadge.js";
import styles from "./TaskTable.module.css";

export interface TaskTableProps {
  tasks: readonly TaskDto[];
  agentNames: ReadonlyMap<string, string>;
  /** 当前筛选 query,保证进入抽屉再关闭后仍是同一视图 */
  search: string;
  now?: number;
}

function taskUrl(id: string, search: string): string {
  return `/tasks/${encodeURIComponent(id)}${search}`;
}

function OutputCell({ output }: { output: string | null }) {
  if (output === null) {
    return <span className={styles.muted}>—</span>;
  }
  if (/^https?:\/\//i.test(output)) {
    return (
      <a
        className={styles.output}
        href={output}
        target="_blank"
        rel="noreferrer"
        title={output}
        onClick={(event) => event.stopPropagation()}
      >
        {output}
      </a>
    );
  }
  return (
    <span className={`${styles.output} ${styles.outputCode}`} title={output}>
      {output}
    </span>
  );
}

export function TaskTable({ tasks, agentNames, search, now = Date.now() }: TaskTableProps) {
  const navigate = useNavigate();

  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>任务</th>
              <th>下发人</th>
              <th>承接</th>
              <th>轮次</th>
              <th>阶段</th>
              <th>状态</th>
              <th>产出</th>
              <th className={styles.numeric}>耗时</th>
              <th className={styles.numeric}>Token</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const url = taskUrl(task.id, search);
              const assigneeName = agentNames.get(task.assignee);
              return (
                <tr key={task.id} className={styles.row} onClick={() => navigate(url)}>
                  <td>
                    <Link
                      className={styles.rowLink}
                      to={url}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span className={styles.primary}>{task.title}</span>
                    </Link>
                    <div className={styles.subline}>
                      <code className={styles.mono}>{task.id}</code>
                      <span className={styles.origin}>{TASK_ORIGIN_LABEL[task.origin]}</span>
                    </div>
                  </td>
                  <td>{task.assigner}</td>
                  <td>
                    <div>{assigneeName ?? task.assignee}</div>
                    {assigneeName === undefined ? null : (
                      <div className={styles.mono}>{task.assignee}</div>
                    )}
                  </td>
                  <td>
                    第 {task.round} 轮
                    {task.rework_count > 0 ? (
                      <div className={styles.muted}>返工 {task.rework_count} 次</div>
                    ) : null}
                  </td>
                  <td>{TASK_STAGE_LABEL[task.stage]}</td>
                  <td>
                    <StatusBadge
                      tone={TASK_STATUS_TONE[task.status]}
                      text={TASK_STATUS_LABEL[task.status]}
                    />
                  </td>
                  <td>
                    <OutputCell output={task.output} />
                  </td>
                  <td
                    className={styles.numeric}
                    title={formatDuration((task.ended_at ?? now) - task.created_at)}
                  >
                    {formatCompactDuration((task.ended_at ?? now) - task.created_at)}
                  </td>
                  <td className={styles.numeric} title={formatExactTokens(task.total_tokens)}>
                    {formatTokens(task.total_tokens)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 移动端只留最关键三列:任务 / 承接 / 状态,其余进详情抽屉(03 §8) */}
      <ul className={styles.cards} aria-label="任务卡片">
        {tasks.map((task) => {
          const assigneeName = agentNames.get(task.assignee);
          return (
            <li key={task.id} className={styles.card}>
              <Link
                className={styles.cardLink}
                to={taskUrl(task.id, search)}
                aria-label={task.title}
              >
                <span className={styles.cardTop}>
                  <span className={styles.cardTitle}>{task.title}</span>
                  <StatusBadge
                    tone={TASK_STATUS_TONE[task.status]}
                    text={TASK_STATUS_LABEL[task.status]}
                  />
                </span>
                <span className={styles.cardMeta}>
                  <span className={styles.cardMetaLabel}>承接</span>
                  <span>{assigneeName ?? task.assignee}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
