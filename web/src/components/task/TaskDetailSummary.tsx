import type { ReactNode } from "react";
import type { TaskCapability, TaskDto, TaskEventDto, TaskTokenSummary } from "../../api/tasks.js";
import {
  formatCompactDuration,
  formatDateTime,
  formatExactTokens,
  formatTokens,
} from "../../shared/format.js";
import {
  CAPABILITY_STATUS_LABEL,
  CAPABILITY_STATUS_TONE,
  TASK_EVENT_LABEL,
  TASK_STAGE_LABEL,
} from "../../shared/labels.js";
import { StatusBadge } from "../data/StatusBadge.js";
import { describeTaskEvent, latestEventReason } from "./task-event.js";
import styles from "./task-drawer.module.css";

export interface TaskDetailSummaryProps {
  task: TaskDto;
  capabilities: readonly TaskCapability[];
  tokens: TaskTokenSummary;
  events: readonly TaskEventDto[];
  agentNames: ReadonlyMap<string, string>;
  now: number;
}

const TERMINAL_STATUSES: readonly TaskDto["status"][] = ["done", "cancelled"];

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.summaryRow}>
      <dt className={styles.summaryLabel}>{label}</dt>
      <dd className={styles.summaryValue}>{children}</dd>
    </div>
  );
}

function OutputValue({ output }: { output: string | null }) {
  if (output === null) {
    return <span className={styles.muted}>—</span>;
  }
  if (/^https?:\/\//i.test(output)) {
    return (
      <a className={styles.output} href={output} target="_blank" rel="noreferrer" title={output}>
        {output}
      </a>
    );
  }
  return (
    <code className={styles.outputCode} title={output}>
      {output}
    </code>
  );
}

export function TaskDetailSummary({
  task,
  capabilities,
  tokens,
  events,
  agentNames,
  now,
}: TaskDetailSummaryProps) {
  const assigneeName = agentNames.get(task.assignee);
  const last = events.at(-1);
  const terminal = TERMINAL_STATUSES.includes(task.status);
  const reason = task.status === "blocked" ? latestEventReason(events) : null;
  const since = last?.occurred_at ?? task.updated_at;

  return (
    <section className={styles.summary} aria-label="任务摘要">
      <dl className={styles.summaryRows}>
        <SummaryRow label="项目">{task.project}</SummaryRow>
        <SummaryRow label="承接">
          {assigneeName ?? task.assignee}
          {assigneeName === undefined ? null : (
            <span className={styles.inlineMono}>{task.assignee}</span>
          )}
        </SummaryRow>
        <SummaryRow label="下发">{task.assigner}</SummaryRow>
        <SummaryRow label="阶段">{TASK_STAGE_LABEL[task.stage]}</SummaryRow>
        <SummaryRow label="轮次">
          第 {task.round} 轮
          {task.rework_count > 0 ? ` · 返工 ${task.rework_count} 次` : ""}
        </SummaryRow>
        <SummaryRow label="成本">
          <span title={formatExactTokens(tokens.total)}>{formatTokens(tokens.total)} tok</span> · 耗时{" "}
          {formatCompactDuration((task.ended_at ?? now) - task.created_at)}
        </SummaryRow>
        <SummaryRow label="产出">
          <OutputValue output={task.output} />
        </SummaryRow>
        <SummaryRow label="截止">
          {task.deadline_at === null ? "—" : formatDateTime(task.deadline_at)}
        </SummaryRow>
        <SummaryRow label="最后事件">
          {last === undefined
            ? "暂无事件"
            : `#${last.seq} ${TASK_EVENT_LABEL[last.kind]} · ${formatDateTime(last.occurred_at)}`}
        </SummaryRow>
        <SummaryRow label="阻塞原因">
          {task.status !== "blocked"
            ? "当前未阻塞"
            : reason ?? "未记录原因（事件 payload 无 reason）"}
        </SummaryRow>
        <SummaryRow label="已等待">
          {terminal ? "已收尾" : formatCompactDuration(now - since)}
        </SummaryRow>
      </dl>
      {last === undefined ? null : <p className={styles.hint}>{describeTaskEvent(last)}</p>}

      <div className={styles.inlineSection}>
        <h4 className={styles.inlineTitle}>关联凭证</h4>
        {capabilities.length === 0 ? (
          <p className={styles.muted}>未关联授权凭证。</p>
        ) : (
          <ul className={styles.capList}>
            {capabilities.map((capability) => (
              <li key={capability.id} className={styles.capItem}>
                <StatusBadge
                  tone={CAPABILITY_STATUS_TONE[capability.status]}
                  text={CAPABILITY_STATUS_LABEL[capability.status]}
                />{" "}
                <code className={styles.outputCode}>{capability.action}</code>{" "}
                {capability.target}
                <span className={styles.muted}>
                  {capability.expires_at === null
                    ? " · 无到期时间"
                    : ` · 到期 ${formatDateTime(capability.expires_at)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
