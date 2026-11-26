import type { ReactNode } from "react";
import type { WorkHoldReason } from "@shared/constants.js";
import type {
  WorkItemInboxLink,
  WorkItemRunLink,
  WorkItemTaskLink,
  WorkItemThreadLink,
} from "../../api/work-items.js";
import { formatDateTime, formatDuration } from "../../shared/format.js";
import {
  THREAD_MODE_LABEL,
  WORKER_INBOX_KIND_LABEL,
  WORKER_INBOX_STATUS_LABEL,
  WORK_HOLD_REASON_LABEL,
} from "../../shared/labels.js";
import { agentMentionLabel } from "../../shared/agent-label.js";

export interface WorkItemRelationsProps {
  tasks: readonly WorkItemTaskLink[];
  runs: readonly WorkItemRunLink[];
  inbox: readonly WorkItemInboxLink[];
  threads: readonly WorkItemThreadLink[];
  agentNames: ReadonlyMap<string, string>;
  onOpenTask: (taskId: string) => void;
}

function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-foreground">
        {title}
        <span className="text-xs font-normal text-muted">{count}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted">{text}</p>;
}

export function WorkItemRelations({
  tasks,
  runs,
  inbox,
  threads,
  agentNames,
  onOpenTask,
}: WorkItemRelationsProps) {
  return (
    <section className="mb-5 last:mb-0" aria-label="关联工作">
      <h3 className="mb-1 text-md font-bold text-foreground">关联工作</h3>

      <Group title="关联任务" count={tasks.length}>
        {tasks.length === 0 ? (
          <Empty text="暂无关联任务" />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {tasks.map((task) => (
              <li key={task.id} className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 p-3">
                <button
                  type="button"
                  className="cursor-pointer break-words border-0 bg-transparent p-0 text-left font-[inherit] font-semibold text-accent enabled:hover:underline"
                  onClick={() => onOpenTask(task.id)}
                >
                  {task.title}
                </button>
                <span className="flex flex-wrap items-baseline gap-2 text-xs text-muted">
                  <span>{agentMentionLabel(task.assignee, agentNames, task.assignee)}</span>
                  <span>·</span>
                  <span>{task.status}</span>
                  <span>·</span>
                  <span>{formatDateTime(task.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="执行记录" count={runs.length}>
        {runs.length === 0 ? (
          <Empty text="暂无执行记录" />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 p-3">
                <span className="break-words text-sm font-semibold text-foreground">
                  {agentMentionLabel(run.agentId, agentNames, run.agentId)}
                </span>
                <span className="flex flex-wrap items-baseline gap-2 text-xs text-muted">
                  <span>{run.status}</span>
                  {run.startedAt === null ? null : (
                    <>
                      <span>·</span>
                      <span>{formatDateTime(run.startedAt)}</span>
                    </>
                  )}
                  {run.endedAt === null ? null : (
                    <>
                      <span>·</span>
                      <span>结束 {formatDateTime(run.endedAt)}</span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="派工与续接" count={inbox.length}>
        {inbox.length === 0 ? (
          <Empty text="暂无派工与续接输入" />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {inbox.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 p-3">
                <span className="break-words text-sm font-semibold text-foreground">
                  {WORKER_INBOX_KIND_LABEL[row.kind] ?? row.kind}
                  {" · "}
                  {agentMentionLabel(row.targetAgentId, agentNames, row.targetAgentId)}
                </span>
                <span className="flex flex-wrap items-baseline gap-2 text-xs text-muted">
                  <span>{WORKER_INBOX_STATUS_LABEL[row.status] ?? row.status}</span>
                  {row.reason === null ? null : (
                    <>
                      <span>·</span>
                      <span>
                        挂起:{WORK_HOLD_REASON_LABEL[row.reason as WorkHoldReason] ?? row.reason} · 已挂起{" "}
                        {formatDuration(Date.now() - row.updatedAt)}
                      </span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="关联线程" count={threads.length}>
        {threads.length === 0 ? (
          <Empty text="暂无关联线程" />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {threads.map((thread) => (
              <li key={thread.subscriptionId} className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 p-3">
                <span className="break-words text-sm font-semibold text-foreground">
                  {THREAD_MODE_LABEL[thread.mode] ?? thread.mode}
                  {" · "}
                  {thread.source}
                  {" · "}
                  {thread.externalKind}
                </span>
                <span className="flex flex-wrap items-baseline gap-2 text-xs text-muted">
                  {/^https?:\/\//i.test(thread.externalKey) ? (
                    <a
                      className="break-words text-accent"
                      href={thread.externalKey}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {thread.externalKey}
                    </a>
                  ) : (
                    <span className="font-mono text-xs text-subtle">{thread.externalKey}</span>
                  )}
                  {thread.revokedAt === null ? null : (
                    <>
                      <span>·</span>
                      <span>已撤销 {formatDateTime(thread.revokedAt)}</span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </section>
  );
}
