import { Link, useNavigate } from "react-router";
import type { TaskDto } from "../../api/tasks.js";
import {
  formatCompactDuration,
  formatDuration,
  formatExactTokens,
  formatTokens,
} from "../../shared/format.js";
import { TASK_ORIGIN_LABEL, TASK_STAGE_LABEL, TASK_STATUS_LABEL, TASK_STATUS_TONE } from "../../shared/labels.js";
import { Badge } from "../ui/Badge.js";
import { Table, type TableColumn } from "../ui/Table.js";
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

  const columns: TableColumn<TaskDto>[] = [
    {
      key: "task",
      header: "任务",
      width: "26%",
      render: (task) => (
        <>
          <Link
            className={styles.rowLink}
            to={taskUrl(task.id, search)}
            onClick={(event) => event.stopPropagation()}
          >
            <span className={styles.primary}>{task.title}</span>
          </Link>
          <div className={styles.subline}>
            <code className={styles.mono}>{task.id}</code>
            <span className={styles.origin}>{TASK_ORIGIN_LABEL[task.origin]}</span>
          </div>
        </>
      ),
    },
    {
      key: "assigner",
      header: "下发人",
      width: "10%",
      render: (task) => {
        // 下发人也可能是 Agent,取不到名字时回退后端标签(系统派单为「aw-console」等)
        const name = agentNames.get(task.assigner);
        return (
          <span className={styles.clip} title={task.assigner_label}>
            {name ?? task.assigner_label}
          </span>
        );
      },
    },
    {
      key: "assignee",
      header: "承接",
      width: "13%",
      render: (task) => {
        const name = agentNames.get(task.assignee);
        return (
          <>
            <span className={styles.clip}>{name ?? task.assignee_label}</span>
            {name === undefined ? null : (
              <span className={`${styles.mono} ${styles.clip}`}>{task.assignee}</span>
            )}
          </>
        );
      },
    },
    {
      key: "round",
      header: "轮次",
      width: "6%",
      nowrap: true,
      render: (task) => (
        <>
          <div>第 {task.round} 轮</div>
          {task.rework_count > 0 ? (
            <div className={styles.muted}>返工 {task.rework_count} 次</div>
          ) : null}
        </>
      ),
    },
    {
      key: "stage",
      header: "阶段",
      width: "6%",
      render: (task) => TASK_STAGE_LABEL[task.stage],
    },
    {
      key: "status",
      header: "状态",
      width: "8%",
      render: (task) => (
        <Badge tone={TASK_STATUS_TONE[task.status]} text={TASK_STATUS_LABEL[task.status]} />
      ),
    },
    {
      key: "output",
      header: "产出",
      width: "15%",
      render: (task) => (
        <span className={styles.clipWide}>
          <OutputCell output={task.output} />
        </span>
      ),
    },
    {
      key: "duration",
      header: "耗时",
      width: "8%",
      align: "right",
      nowrap: true,
      render: (task) => (
        <span title={formatDuration((task.ended_at ?? now) - task.created_at)}>
          {formatCompactDuration((task.ended_at ?? now) - task.created_at)}
        </span>
      ),
    },
    {
      key: "tokens",
      header: "Token",
      width: "8%",
      align: "right",
      nowrap: true,
      render: (task) => (
        <span title={formatExactTokens(task.total_tokens)}>{formatTokens(task.total_tokens)}</span>
      ),
    },
  ];

  return (
    <>
      <div className={styles.tableArea}>
        <Table
          columns={columns}
          rows={[...tasks]}
          rowKey={(task) => task.id}
          minWidth="960px"
          fixedLayout
          onRowClick={(task) => navigate(taskUrl(task.id, search))}
        />
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
                  <Badge
                    tone={TASK_STATUS_TONE[task.status]}
                    text={TASK_STATUS_LABEL[task.status]}
                  />
                </span>
                <span className={styles.cardMeta}>
                  <span className={styles.cardMetaLabel}>承接</span>
                  <span>{assigneeName ?? task.assignee_label}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
