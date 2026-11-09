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
import styles from "./work-item-drawer.module.css";

export interface WorkItemRelationsProps {
  tasks: readonly WorkItemTaskLink[];
  runs: readonly WorkItemRunLink[];
  inbox: readonly WorkItemInboxLink[];
  threads: readonly WorkItemThreadLink[];
  agentNames: ReadonlyMap<string, string>;
  /** 跳到任务详情;工作事项与任务两个维度,入口在关联任务里 */
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
    <div className={styles.group}>
      <div className={styles.groupTitle}>
        {title}
        <span className={styles.groupCount}>{count}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className={styles.empty}>{text}</p>;
}

/** 关联工作:任务 / 执行 / 派工 / 线程;没有就是没有,不补假节点 */
export function WorkItemRelations({
  tasks,
  runs,
  inbox,
  threads,
  agentNames,
  onOpenTask,
}: WorkItemRelationsProps) {
  return (
    <section className={styles.block} aria-label="关联工作">
      <h3 className={styles.blockTitle}>关联工作</h3>
      <p className={styles.blockHint}>任务与执行是干的事，派工与线程是协作事实</p>

      <Group title="关联任务" count={tasks.length}>
        {tasks.length === 0 ? (
          <Empty text="暂无关联任务" />
        ) : (
          <ul className={styles.linkList}>
            {tasks.map((task) => (
              <li key={task.id} className={styles.linkRow}>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => onOpenTask(task.id)}
                >
                  {task.title}
                </button>
                <span className={styles.linkMeta}>
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
          <ul className={styles.linkList}>
            {runs.map((run) => (
              <li key={run.id} className={styles.linkRow}>
                <span className={styles.linkTitle}>
                  {agentMentionLabel(run.agentId, agentNames, run.agentId)}
                </span>
                <span className={styles.linkMeta}>
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
          <ul className={styles.linkList}>
            {inbox.map((row) => (
              <li key={row.id} className={styles.linkRow}>
                <span className={styles.linkTitle}>
                  {WORKER_INBOX_KIND_LABEL[row.kind] ?? row.kind}
                  {" · "}
                  {agentMentionLabel(row.targetAgentId, agentNames, row.targetAgentId)}
                </span>
                <span className={styles.linkMeta}>
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
          <ul className={styles.linkList}>
            {threads.map((thread) => (
              <li key={thread.subscriptionId} className={styles.linkRow}>
                <span className={styles.linkTitle}>
                  {THREAD_MODE_LABEL[thread.mode] ?? thread.mode}
                  {" · "}
                  {thread.source}
                  {" · "}
                  {thread.externalKind}
                </span>
                <span className={styles.linkMeta}>
                  {/^https?:\/\//i.test(thread.externalKey) ? (
                    <a
                      className={styles.external}
                      href={thread.externalKey}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {thread.externalKey}
                    </a>
                  ) : (
                    <span className={styles.mono}>{thread.externalKey}</span>
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
