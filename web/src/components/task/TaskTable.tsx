import { Link, useNavigate } from "react-router";
import type { TaskDto } from "../../api/tasks.js";
import {
  formatCompactDuration,
  formatDuration,
  formatExactTokens,
  formatTokens,
} from "../../shared/format.js";
import { TASK_ORIGIN_LABEL, TASK_STAGE_LABEL, TASK_STATUS_LABEL, TASK_STATUS_TONE } from "../../shared/labels.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/Badge.js";
import { Table, type TableColumn } from "../ui/Table.js";
import { mono as sharedMono, muted as sharedMuted } from "./shared.js";

export interface TaskTableProps {
  tasks: readonly TaskDto[];
  agentNames: ReadonlyMap<string, string>;
  /** 当前筛选 query,保证进入抽屉再关闭后仍是同一视图 */
  search: string;
  now?: number;
}

/** 固定列宽表格下由单元格宽度决定截断位置 */
const CLIP = "block overflow-hidden whitespace-nowrap text-ellipsis";

function taskUrl(id: string, search: string): string {
  return `/tasks/${encodeURIComponent(id)}${search}`;
}

function OutputCell({ output }: { output: string | null }) {
  if (output === null) {
    return <span className={sharedMuted}>—</span>;
  }
  if (/^https?:\/\//i.test(output)) {
    return (
      <a
        className="block max-w-full overflow-hidden whitespace-nowrap text-ellipsis text-accent"
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
    <span
      className="block max-w-full overflow-hidden whitespace-nowrap text-ellipsis font-mono text-xs text-accent"
      title={output}
    >
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
            className="block overflow-hidden whitespace-nowrap text-ellipsis text-foreground no-underline hover:text-accent hover:underline"
            to={taskUrl(task.id, search)}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="font-semibold text-foreground">{task.title}</span>
          </Link>
          <div className="mt-1 flex items-center gap-2 text-xs text-subtle">
            <code className={sharedMono}>{task.id}</code>
            <span className="before:content-['·_']">{TASK_ORIGIN_LABEL[task.origin]}</span>
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
          <span className={CLIP} title={task.assigner_label}>
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
            <span className={CLIP}>{name ?? task.assignee_label}</span>
            {name === undefined ? null : (
              <span className={cn(sharedMono, CLIP)}>{task.assignee}</span>
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
            <div className={sharedMuted}>返工 {task.rework_count} 次</div>
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
        <span className="block overflow-hidden">
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
      <div className="max-md:hidden">
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
      <ul
        className="m-0 hidden list-none p-0 max-md:flex max-md:flex-col max-md:gap-3"
        aria-label="任务卡片"
      >
        {tasks.map((task) => {
          const assigneeName = agentNames.get(task.assignee);
          return (
            <li
              key={task.id}
              className="rounded-lg border border-border bg-surface"
            >
              <Link
                className="flex min-h-touch flex-col gap-3 p-4 text-foreground no-underline active:bg-accent-soft"
                to={taskUrl(task.id, search)}
                aria-label={task.title}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="text-md font-semibold [overflow-wrap:anywhere]">{task.title}</span>
                  <Badge
                    tone={TASK_STATUS_TONE[task.status]}
                    text={TASK_STATUS_LABEL[task.status]}
                  />
                </span>
                <span className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="text-xs text-muted">承接</span>
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
