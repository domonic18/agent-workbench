import type { AgentRosterSummary } from "../../api/identity.js";
import type { OverviewAgent } from "../../api/types.js";
import { agentDisplayName, hasCollector } from "../../shared/agent-label.js";
import { formatDateTime, formatExactTokens, formatRelativeTime } from "../../shared/format.js";
import { NOT_COLLECTED, RUNTIME_LABEL, VISIBILITY_NOTE } from "../../shared/labels.js";
import styles from "./agents.module.css";

export interface AgentOverviewPanelProps {
  agent: AgentRosterSummary;
  /** 总览投影的活体状态；未上报时为 undefined */
  live: OverviewAgent | undefined;
}

interface Field {
  label: string;
  value: string;
}

function machineLabel(agent: AgentRosterSummary): string {
  return agent.machineDisplayName ?? agent.machineHostname ?? "未绑定";
}

function limitLabel(agent: AgentRosterSummary): string {
  const limit = agent.usageLimit;
  if (limit === null || limit === undefined || limit.isActive !== true) {
    return "未启用额度控制";
  }
  const stop = limit.hardStop ? "达额停摆" : "只告警";
  return `日 ${formatExactTokens(limit.dailyTokenLimit)} tok · 告警线 ${limit.warnPercent}% · ${stop}`;
}

/** 概览分区：身份档案 + 用量 + 委派与额度 */
export function AgentOverviewPanel({ agent, live }: AgentOverviewPanelProps) {
  const collected = hasCollector(agent);
  const identity: Field[] = [
    { label: "机器人名", value: agentDisplayName(agent) },
    { label: "Agent ID", value: agent.id },
    { label: "项目", value: agent.project },
    { label: "路由 key", value: agent.key ?? "—" },
    { label: "运行时", value: RUNTIME_LABEL[agent.runtime] },
    { label: "宿主机器", value: machineLabel(agent) },
    { label: "飞书应用", value: agent.feishuAppId ?? "未绑定" },
    { label: "启停", value: agent.status === "active" ? "启用" : "已停用" },
    { label: "创建时间", value: formatDateTime(agent.createdAt) },
  ];

  const usage: Field[] = [
    { label: "今日 Token", value: collected ? formatExactTokens(live?.todayTokens ?? 0) : NOT_COLLECTED },
    { label: "累计运行", value: collected ? `${agent.totalRuns} 次` : NOT_COLLECTED },
    { label: "累计 Token", value: collected ? formatExactTokens(agent.totalTokens) : NOT_COLLECTED },
    {
      label: "最近运行",
      value: collected
        ? agent.lastRunAt === null
          ? "从未运行"
          : formatRelativeTime(agent.lastRunAt)
        : NOT_COLLECTED,
    },
    { label: "在办任务", value: `${agent.openTasks} 个` },
    { label: "委派白名单", value: `${agent.allowedTargets.length} 个目标` },
    { label: "用量上限", value: limitLabel(agent) },
  ];

  return (
    <div>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>身份档案</h3>
        <dl className={styles.kvGrid}>
          {identity.map((field) => (
            <div key={field.label} className={styles.kvItem}>
              <dt className={styles.kvLabel}>{field.label}</dt>
              <dd className={styles.kvValue}>{field.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>用量</h3>
        <dl className={styles.kvGrid}>
          {usage.map((field) => (
            <div key={field.label} className={styles.kvItem}>
              <dt className={styles.kvLabel}>{field.label}</dt>
              <dd className={styles.kvValue}>{field.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className={styles.sectionHint}>可见性说明：{VISIBILITY_NOTE}</p>
    </div>
  );
}
