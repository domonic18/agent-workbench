import type { ReactNode } from "react";
import type { TaskCapability, TaskDto, TaskTokenSummary } from "../../api/tasks.js";
import {
  formatDateTime,
  formatDuration,
  formatExactTokens,
  formatTokens,
} from "../../shared/format.js";
import {
  CAPABILITY_STATUS_LABEL,
  CAPABILITY_STATUS_TONE,
  TASK_ORIGIN_LABEL,
  TASK_STAGE_LABEL,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
} from "../../shared/labels.js";
import { StatusBadge } from "../data/StatusBadge.js";
import styles from "./task-drawer.module.css";

export interface TaskDetailSummaryProps {
  task: TaskDto;
  capabilities: readonly TaskCapability[];
  tokens: TaskTokenSummary;
  agentNames: ReadonlyMap<string, string>;
  now: number;
}

function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.gridItem}>
      <dt className={styles.gridLabel}>{label}</dt>
      <dd className={styles.gridValue}>{children}</dd>
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
  agentNames,
  now,
}: TaskDetailSummaryProps) {
  const assigneeName = agentNames.get(task.assignee);

  return (
    <section className={styles.section} aria-label="任务摘要">
      <h3 className={styles.sectionTitle}>摘要</h3>
      <dl className={styles.grid}>
        <SummaryItem label="任务 ID">
          <code className={styles.outputCode}>{task.id}</code>
        </SummaryItem>
        <SummaryItem label="项目">{task.project}</SummaryItem>
        <SummaryItem label="下发人">{task.assigner}</SummaryItem>
        <SummaryItem label="承接">
          {assigneeName ?? task.assignee}
          {assigneeName === undefined ? null : (
            <div className={styles.mono}>{task.assignee}</div>
          )}
        </SummaryItem>
        <SummaryItem label="轮次">
          第 {task.round} 轮
          {task.rework_count > 0 ? ` · 返工 ${task.rework_count} 次` : ""}
        </SummaryItem>
        <SummaryItem label="阶段">{TASK_STAGE_LABEL[task.stage]}</SummaryItem>
        <SummaryItem label="状态">
          <StatusBadge
            tone={TASK_STATUS_TONE[task.status]}
            text={TASK_STATUS_LABEL[task.status]}
          />
        </SummaryItem>
        <SummaryItem label="来源">{TASK_ORIGIN_LABEL[task.origin]}</SummaryItem>
        <SummaryItem label="截止">
          {task.deadline_at === null ? "—" : formatDateTime(task.deadline_at)}
        </SummaryItem>
        <SummaryItem label="创建">{formatDateTime(task.created_at)}</SummaryItem>
        <SummaryItem label="更新">{formatDateTime(task.updated_at)}</SummaryItem>
        <SummaryItem label="耗时">
          {formatDuration((task.ended_at ?? now) - task.created_at)}
        </SummaryItem>
        <SummaryItem label="产出">
          <OutputValue output={task.output} />
        </SummaryItem>
        <SummaryItem label="Token">
          <span title={formatExactTokens(tokens.total)}>{formatTokens(tokens.total)}</span>
          <div className={styles.mono}>{tokens.entries} 条用量记录</div>
        </SummaryItem>
      </dl>

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
