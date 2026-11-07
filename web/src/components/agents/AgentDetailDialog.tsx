import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { fetchAgents } from "../../api/identity.js";
import type { OverviewAgent } from "../../api/types.js";
import { agentDisplayName } from "../../shared/agent-label.js";
import { Dialog } from "../ui/Dialog.js";
import { Tabs } from "../ui/Tabs.js";
import { AgentOverviewPanel } from "./AgentOverviewPanel.js";
import { AgentTaskPanel } from "./AgentTaskPanel.js";
import { AgentTimeline } from "./AgentTimeline.js";
import { statusBadges } from "./agent-rows.js";
import styles from "./agents.module.css";

export interface AgentDetailDialogProps {
  agentId: string;
  /** 总览投影的活体状态 */
  live: OverviewAgent | undefined;
  onClose: () => void;
}

/** 机器人详情抽屉：概览 / 任务 / 对话记录三区，不新增页面 */
export function AgentDetailDialog({ agentId, live, onClose }: AgentDetailDialogProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });
  const agent = agentsQuery.data?.find((item) => item.id === agentId);

  if (agentsQuery.isPending) {
    return (
      <Dialog title="机器人详情" variant="drawer" size="lg" onClose={onClose}>
        <p className={styles.muted}>加载中…</p>
      </Dialog>
    );
  }

  if (agent === undefined) {
    return (
      <Dialog title="机器人详情" variant="drawer" size="lg" onClose={onClose}>
        <p className={styles.error} role="alert">
          该 Agent 已不存在，可能已被删除。
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={agentDisplayName(agent)}
      description={`${agent.project} · ${agent.id}`}
      variant="drawer"
      size="lg"
      onClose={onClose}
      headerExtra={<div className={styles.statusCell}>{statusBadges(agent, live)}</div>}
    >
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          {
            key: "overview",
            label: "概览",
            content: <AgentOverviewPanel agent={agent} live={live} />,
          },
          {
            key: "tasks",
            label: "任务",
            content: (
              <AgentTaskPanel
                agentId={agent.id}
                onOpenTask={(taskId) => {
                  onClose();
                  navigate(`/tasks/${taskId}`);
                }}
              />
            ),
          },
          {
            key: "timeline",
            label: "对话记录",
            content: <AgentTimeline agent={agent} />,
          },
        ]}
      />
    </Dialog>
  );
}
