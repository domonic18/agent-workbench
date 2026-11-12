import { useQuery } from "@tanstack/react-query";
import { Building2, LayoutGrid, Table } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiError } from "../../api/client.js";
import { fetchAgents, type AgentRosterSummary } from "../../api/identity.js";
import type { OverviewAgent } from "../../api/types.js";
import { RUNTIME_LABEL } from "../../shared/labels.js";
import { readPreference, writePreference } from "../../shared/preference.js";
import { NARROW_QUERY, useMediaQuery } from "../../shared/useMediaQuery.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
import { IconButton } from "../ui/IconButton.js";
import { Input, Select } from "../ui/Field.js";
import { AgentCardList } from "./AgentCardList.js";
import { AgentTable, buildAgentColumns } from "./AgentTableColumns.js";
import { AgentOfficeScene } from "./office/AgentOfficeScene.js";
import styles from "./agents.module.css";

export interface AgentManagementTableProps {
  /** 总览投影的活体状态，按 id 与名册合并 */
  liveAgents: readonly OverviewAgent[];
  /** 点机器人名/行打开详情抽屉 */
  onOpenDetail: (agent: AgentRosterSummary) => void;
  onEdit: (agent: AgentRosterSummary) => void;
  onRotateKey: (agent: AgentRosterSummary) => void;
}

type StatusFilter = "all" | "active" | "disabled";
type ViewMode = "list" | "card" | "office";

const VIEW_STORAGE_KEY = "aw:agents-view";

const VIEW_OPTIONS: ViewMode[] = ["list", "card", "office"];

function readViewPreference(): ViewMode {
  const saved = readPreference(VIEW_STORAGE_KEY, "list");
  return VIEW_OPTIONS.includes(saved as ViewMode) ? (saved as ViewMode) : "list";
}

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
  onOpenDetail,
  onEdit,
  onRotateKey,
}: AgentManagementTableProps) {
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [runtime, setRuntime] = useState("all");
  const [machine, setMachine] = useState("all");
  const [view, setView] = useState<ViewMode>(readViewPreference);
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

  function changeView(next: ViewMode): void {
    setView(next);
    writePreference(VIEW_STORAGE_KEY, next);
  }

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
            aria-label="搜索机器人"
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
        <div className={styles.viewToggle} role="group" aria-label="显示方式">
          <IconButton
            size="sm"
            label="列表视图"
            aria-pressed={view === "list"}
            icon={<Table size={14} />}
            className={view === "list" ? styles.viewActive : undefined}
            onClick={() => changeView("list")}
          />
          <IconButton
            size="sm"
            label="卡片视图"
            aria-pressed={view === "card"}
            icon={<LayoutGrid size={14} />}
            className={view === "card" ? styles.viewActive : undefined}
            onClick={() => changeView("card")}
          />
          <IconButton
            size="sm"
            label={narrow ? "办公室视图（窄屏不支持）" : "办公室视图"}
            aria-pressed={view === "office" && !narrow}
            icon={<Building2 size={14} />}
            className={view === "office" && !narrow ? styles.viewActive : undefined}
            disabled={narrow}
            onClick={() => changeView("office")}
          />
        </div>
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
      ) : narrow || view === "card" ? (
        <AgentCardList
          agents={visible}
          liveById={liveById}
          onOpenDetail={onOpenDetail}
          onEdit={onEdit}
          onRotateKey={onRotateKey}
        />
      ) : view === "office" ? (
        <AgentOfficeScene agents={visible} liveById={liveById} onOpenDetail={onOpenDetail} />
      ) : (
        <AgentTable agents={visible} columns={columns} onOpenDetail={onOpenDetail} />
      )}
    </div>
  );
}
