import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ApiError } from "../../api/client.js";
import { fetchAgents, type AgentRosterSummary } from "../../api/identity.js";
import type { OverviewAgent } from "../../api/types.js";
import {
  formatDateTime,
  formatExactTokens,
  formatRelativeTime,
  formatTokens,
} from "../../shared/format.js";
import { HEARTBEAT_LABEL, HEARTBEAT_TONE, RUNTIME_LABEL } from "../../shared/labels.js";
import { NARROW_QUERY, useMediaQuery } from "../../shared/useMediaQuery.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
import { Input, Select } from "../ui/Field.js";
import { Table, type TableColumn } from "../ui/Table.js";
import styles from "./agents.module.css";

export interface AgentManagementTableProps {
  /** 总览投影的活体状态，按 id 与名册合并 */
  liveAgents: readonly OverviewAgent[];
  onEdit: (agent: AgentRosterSummary) => void;
  onRotateKey: (agent: AgentRosterSummary) => void;
}

type StatusFilter = "all" | "active" | "disabled";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "全部状态" },
  { value: "active", label: "启用" },
  { value: "disabled", label: "已停用" },
];

function matches(agent: AgentRosterSummary, keyword: string): boolean {
  if (keyword === "") {
    return true;
  }
  const haystack = [agent.displayName, agent.project, agent.key ?? "", agent.id]
    .join(" ")
    .toLowerCase();
  return haystack.includes(keyword);
}

function taskMeta(live: OverviewAgent | undefined): string {
  if (live === undefined) {
    return "";
  }
  const stage = live.currentTaskStage ?? "";
  const status = live.currentTaskStatus ?? "";
  return [stage, status].filter((part) => part !== "").join(" · ");
}

/** 状态列三段编码：启停 + 心跳 + 运行态，颜色之外都带文字 */
function statusBadges(agent: AgentRosterSummary, live: OverviewAgent | undefined) {
  const badges = [];
  if (agent.status === "disabled") {
    badges.push(<Badge key="disabled" tone="muted" text="已停用" />);
  } else {
    badges.push(<Badge key="enabled" tone="positive" text="启用" />);
  }
  if (agent.status === "active") {
    badges.push(
      <Badge
        key="heartbeat"
        tone={HEARTBEAT_TONE[live?.heartbeat ?? "unknown"]}
        text={HEARTBEAT_LABEL[live?.heartbeat ?? "unknown"]}
      />,
    );
    if (live?.running === true) {
      badges.push(<Badge key="running" tone="info" text="运行中" />);
    }
  }
  return badges;
}

export function AgentManagementTable({
  liveAgents,
  onEdit,
  onRotateKey,
}: AgentManagementTableProps) {
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [runtime, setRuntime] = useState("all");
  const [machine, setMachine] = useState("all");
  const narrow = useMediaQuery(NARROW_QUERY);
  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });

  const liveById = useMemo(() => {
    const map = new Map<string, OverviewAgent>();
    for (const agent of liveAgents) {
      map.set(agent.id, agent);
    }
    return map;
  }, [liveAgents]);

  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);

  const runtimes = useMemo(
    () => [...new Set(agents.map((agent) => agent.runtime))].sort(),
    [agents],
  );
  const machines = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) {
      map.set(agent.machineId ?? "none", agent.machineHostname ?? "未绑定机器");
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "zh-Hans-CN"));
  }, [agents]);

  const visible = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return agents.filter((agent) => {
      if (!matches(agent, needle)) {
        return false;
      }
      if (status !== "all" && agent.status !== status) {
        return false;
      }
      if (runtime !== "all" && agent.runtime !== runtime) {
        return false;
      }
      if (machine !== "all" && (agent.machineId ?? "none") !== machine) {
        return false;
      }
      return true;
    });
  }, [agents, keyword, machine, runtime, status]);

  const columns: TableColumn<AgentRosterSummary>[] = [
    {
      key: "agent",
      header: "Agent",
      render: (agent) => (
        <div className={styles.identity}>
          <span className={styles.identityName}>{agent.displayName}</span>
          <span className={styles.identitySub}>
            {agent.project}
            {agent.key === null ? "" : ` · ${agent.key}`}
          </span>
        </div>
      ),
    },
    {
      key: "runtime",
      header: "运行时",
      render: (agent) => RUNTIME_LABEL[agent.runtime],
    },
    {
      key: "machine",
      header: "机器",
      render: (agent) => agent.machineHostname ?? "未绑定",
    },
    {
      key: "status",
      header: "状态",
      render: (agent) => (
        <div className={styles.statusCell}>{statusBadges(agent, liveById.get(agent.id))}</div>
      ),
    },
    {
      key: "task",
      header: "当前任务",
      render: (agent) => {
        const live = liveById.get(agent.id);
        const title = live?.currentTaskTitle ?? null;
        const meta = taskMeta(live);
        if (title === null) {
          return <span className={styles.muted}>—</span>;
        }
        return (
          <div className={styles.taskCell}>
            <span className={styles.taskTitle} title={title}>
              {title}
            </span>
            {meta === "" ? null : <span className={styles.taskMeta}>{meta}</span>}
          </div>
        );
      },
    },
    {
      key: "todayTokens",
      header: "今日 Token",
      align: "right",
      render: (agent) => {
        const live = liveById.get(agent.id);
        if (live === undefined) {
          return <span className={styles.muted}>—</span>;
        }
        return (
          <span title={formatExactTokens(live.todayTokens)}>
            {formatTokens(live.todayTokens)}
          </span>
        );
      },
    },
    {
      key: "runs",
      header: "累计运行",
      align: "right",
      render: (agent) => (
        <div>
          <div>{agent.totalRuns} 次</div>
          <div className={styles.taskMeta}>{formatTokens(agent.totalTokens)} tok</div>
        </div>
      ),
    },
    {
      key: "lastRun",
      header: "最近运行",
      render: (agent) => {
        if (agent.lastRunAt === null) {
          return <span className={styles.muted}>从未运行</span>;
        }
        return (
          <span title={formatDateTime(agent.lastRunAt)}>
            {formatRelativeTime(agent.lastRunAt)}
          </span>
        );
      },
    },
    {
      key: "actions",
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

  if (agentsQuery.isPending) {
    return <p className={styles.muted}>加载中…</p>;
  }

  if (agentsQuery.isError) {
    return (
      <div role="alert">
        <span>
          {agentsQuery.error instanceof ApiError
            ? agentsQuery.error.message
            : "Agent 名册加载失败"}
        </span>
        <Button size="sm" onClick={() => void agentsQuery.refetch()}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Input
            type="search"
            value={keyword}
            placeholder="搜索显示名 / 项目 / key"
            aria-label="搜索 Agent"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        <Select
          className={styles.select}
          value={status}
          aria-label="按启停筛选"
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select
          className={styles.select}
          value={runtime}
          aria-label="按运行时筛选"
          onChange={(event) => setRuntime(event.target.value)}
        >
          <option value="all">全部运行时</option>
          {runtimes.map((value) => (
            <option key={value} value={value}>
              {RUNTIME_LABEL[value]}
            </option>
          ))}
        </Select>
        <Select
          className={styles.select}
          value={machine}
          aria-label="按机器筛选"
          onChange={(event) => setMachine(event.target.value)}
        >
          <option value="all">全部机器</option>
          {machines.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <span className={styles.resultCount}>
          {visible.length} / {agents.length} 个 Agent
        </span>
      </div>

      {visible.length === 0 ? (
        agents.length === 0 ? (
          <EmptyState
            title="名册里还没有 Agent"
            description="先注册 Agent，执行机装好 aw-node 后会自动出现在这里。"
          />
        ) : (
          <EmptyState title="没有匹配的 Agent" description="换个关键词，或清掉筛选条件再试。" />
        )
      ) : narrow ? (
        <ul className={styles.cardList} aria-label="Agent 卡片">
          {visible.map((agent) => {
            const live = liveById.get(agent.id);
            return (
              <li key={agent.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <div className={styles.identity}>
                    <span className={styles.identityName}>{agent.displayName}</span>
                    <span className={styles.identitySub}>
                      {agent.project} · {RUNTIME_LABEL[agent.runtime]}
                    </span>
                  </div>
                  <div className={styles.statusCell}>{statusBadges(agent, live)}</div>
                </div>
                <div className={styles.cardMeta}>
                  <span>累计运行 {agent.totalRuns} 次</span>
                  <span>累计 {formatTokens(agent.totalTokens)} tok</span>
                  <span>
                    最近运行{" "}
                    {agent.lastRunAt === null
                      ? "从未运行"
                      : formatRelativeTime(agent.lastRunAt)}
                  </span>
                </div>
                <div className={styles.rowActionsLeft}>
                  <Button size="sm" variant="secondary" onClick={() => onEdit(agent)}>
                    管理
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onRotateKey(agent)}>
                    密钥
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={styles.tableArea}>
          <Table
            columns={columns}
            rows={visible}
            rowKey={(agent) => agent.id}
            onRowClick={onEdit}
          />
        </div>
      )}
    </div>
  );
}
