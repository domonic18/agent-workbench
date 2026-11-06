import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ApiError } from "../../api/client.js";
import { fetchAgents, type AgentRosterSummary } from "../../api/identity.js";
import type { OverviewAgent } from "../../api/types.js";
import { RUNTIME_LABEL } from "../../shared/labels.js";
import { NARROW_QUERY, useMediaQuery } from "../../shared/useMediaQuery.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
import { Input, Select } from "../ui/Field.js";
import { AgentCardList } from "./AgentCardList.js";
import { AgentTable, buildAgentColumns } from "./AgentTableColumns.js";
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
  const haystack = [
    agent.displayName,
    agent.feishuBotName ?? "",
    agent.project,
    agent.key ?? "",
    agent.id,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(keyword);
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
      map.set(
        agent.machineId ?? "none",
        agent.machineDisplayName ?? agent.machineHostname ?? "未绑定机器",
      );
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

  const columns = useMemo(
    () => buildAgentColumns({ liveById, onEdit, onRotateKey }),
    [liveById, onEdit, onRotateKey],
  );

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
            placeholder="搜索机器人名 / 项目 / key"
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
        <AgentCardList
          agents={visible}
          liveById={liveById}
          onEdit={onEdit}
          onRotateKey={onRotateKey}
        />
      ) : (
        <AgentTable agents={visible} columns={columns} onEdit={onEdit} />
      )}
    </div>
  );
}
