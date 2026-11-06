import type { AgentRosterSummary } from "../../api/identity.js";
import type { OverviewAgent } from "../../api/types.js";
import { formatDateTime, formatExactTokens, formatRelativeTime, formatTokens } from "../../shared/format.js";
import { NOT_COLLECTED, RUNTIME_LABEL } from "../../shared/labels.js";
import { agentDisplayName, hasCollector } from "../../shared/agent-label.js";
import { Button } from "../ui/Button.js";
import { Table, type TableColumn } from "../ui/Table.js";
import { statusBadges, taskMeta } from "./agent-rows.js";
import styles from "./agents.module.css";

export interface AgentColumnOptions {
  liveById: ReadonlyMap<string, OverviewAgent>;
  onEdit: (agent: AgentRosterSummary) => void;
  onRotateKey: (agent: AgentRosterSummary) => void;
}

/** 宽屏表格的列定义：Agent / 运行时 / 机器 / 状态 / 当前任务 / 今日 Token / 累计运行 / 最近运行 / 操作 */
export function buildAgentColumns(options: AgentColumnOptions): TableColumn<AgentRosterSummary>[] {
  const { liveById, onEdit, onRotateKey } = options;
  return [
    {
      key: "agent",
      width: "168px",
      header: "Agent",
      render: (agent) => (
        <div className={styles.identity}>
          <span className={styles.identityName}>{agentDisplayName(agent)}</span>
          <span className={styles.identitySub}>
            {agent.project}
            {/* 路由 key 默认等于 cc-connect 项目名,重复时不再赘述 */}
            {agent.key === null || agent.key === agent.project ? "" : ` · ${agent.key}`}
          </span>
        </div>
      ),
    },
    {
      key: "runtime",
      width: "88px",
      header: "运行时",
      render: (agent) => RUNTIME_LABEL[agent.runtime],
    },
    {
      key: "machine",
      width: "108px",
      header: "机器",
      render: (agent) => agent.machineDisplayName ?? agent.machineHostname ?? "未绑定",
    },
    {
      key: "status",
      width: "128px",
      header: "状态",
      render: (agent) => (
        <div className={styles.statusCell}>{statusBadges(agent, liveById.get(agent.id))}</div>
      ),
    },
    {
      key: "task",
      width: "200px",
      header: "当前任务",
      render: (agent) => {
        const live = liveById.get(agent.id);
        const title = live?.currentTaskTitle ?? null;
        if (title !== null) {
          const meta = taskMeta(live);
          return (
            <div className={styles.taskCell}>
              <span className={styles.taskTitle} title={title}>
                {title}
              </span>
              {meta === "" ? null : <span className={styles.taskMeta}>{meta}</span>}
            </div>
          );
        }
        // 未建单的运行会话没有任务标题，用最近一条指令回答「在忙什么」，比一句横杠有用
        if (live?.running === true && live.currentInstruction !== null) {
          return (
            <div className={styles.taskCell}>
              <span className={styles.taskTitle} title={live.currentInstruction}>
                <span className={styles.instructionTag}>最近指令</span>
                {live.currentInstruction}
              </span>
            </div>
          );
        }
        return (
          <span className={styles.muted}>
            {live?.running === true ? "运行中 · 当前会话未关联任务" : "当前没有进行中的任务"}
          </span>
        );
      },
    },
    {
      key: "todayTokens",
      width: "84px",
      header: "今日 Token",
      align: "right",
      render: (agent) => {
        // 外部运行时没有 aw-node 采集,Token 固定「未接入 / —」,不显示为 0
        if (!hasCollector(agent)) {
          return <span className={styles.muted}>{NOT_COLLECTED}</span>;
        }
        const live = liveById.get(agent.id);
        if (live === undefined) {
          return <span className={styles.muted}>—</span>;
        }
        return (
          <span title={formatExactTokens(live.todayTokens)}>{formatTokens(live.todayTokens)}</span>
        );
      },
    },
    {
      key: "runs",
      width: "88px",
      header: "累计运行",
      align: "right",
      render: (agent) => {
        if (!hasCollector(agent)) {
          return <span className={styles.muted}>{NOT_COLLECTED}</span>;
        }
        return (
          <div>
            <div>{agent.totalRuns} 次</div>
            <div className={styles.taskMeta}>{formatTokens(agent.totalTokens)} tok</div>
          </div>
        );
      },
    },
    {
      key: "lastRun",
      width: "88px",
      header: "最近运行",
      render: (agent) => {
        if (!hasCollector(agent)) {
          return <span className={styles.muted}>{NOT_COLLECTED}</span>;
        }
        if (agent.lastRunAt === null) {
          return <span className={styles.muted}>从未运行</span>;
        }
        return <span title={formatDateTime(agent.lastRunAt)}>{formatRelativeTime(agent.lastRunAt)}</span>;
      },
    },
    {
      key: "actions",
      width: "92px",
      header: "操作",
      align: "right",
      render: (agent) => (
        <div className={styles.rowActions}>
          {/* 行点击进管理：动作按钮要先截断冒泡，否则一次点击触发两件事 */}
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              onRotateKey(agent);
            }}
          >
            密钥
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={(event) => {
              event.stopPropagation();
              onEdit(agent);
            }}
          >
            管理
          </Button>
        </div>
      ),
    },
  ];
}

export interface AgentTableProps {
  agents: readonly AgentRosterSummary[];
  columns: TableColumn<AgentRosterSummary>[];
  onEdit: (agent: AgentRosterSummary) => void;
}

/** 宽屏表格 */
export function AgentTable({ agents, columns, onEdit }: AgentTableProps) {
  return (
    <div className={styles.tableArea}>
      <Table
        columns={columns}
        rows={[...agents]}
        rowKey={(agent) => agent.id}
        onRowClick={onEdit}
        fixedLayout
      />
    </div>
  );
}
