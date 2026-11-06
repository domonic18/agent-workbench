import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client.js";
import {
  confirmAgents,
  fetchDiscovery,
  type DiscoveryMachineView,
} from "../../api/bootstrap.js";
import { formatRelativeTime } from "../../shared/format.js";
import { MachineRenameDialog } from "../machines/MachineRenameDialog.js";
import { useProjectSelection } from "../machines/useProjectSelection.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
import { ErrorState } from "../ui/ErrorState.js";
import { LoadingState } from "../ui/LoadingState.js";
import { Panel } from "../ui/Panel.js";
import { useToast } from "../ui/Toast.js";
import type { Tone } from "../../shared/labels.js";
import styles from "./onboarding.module.css";

const STATUS_TONE: Record<string, Tone> = {
  active: "positive",
  pending: "warning",
  revoked: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  active: "已激活",
  pending: "待激活",
  revoked: "已吊销",
};

function MachineRow({
  machine,
  onRegistered,
}: {
  machine: DiscoveryMachineView;
  onRegistered: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const tone = STATUS_TONE[machine.status] ?? "muted";
  const label = STATUS_LABEL[machine.status] ?? machine.status;
  const confirmed = machine.projects.filter((project) => project.confirmed).length;
  // 心跳与发现上报不同源:心跳是存活上报,发现是 cc-connect 扫描结果,不能混用
  const heartbeat = machine.lastSeenAt === null ? "未上报" : formatRelativeTime(machine.lastSeenAt);
  const discovered = machine.receivedAt === null ? "未上报" : formatRelativeTime(machine.receivedAt);
  const pending = machine.projects.filter((project) => !project.confirmed);
  const { pickedFor, toggle, isChecked } = useProjectSelection([
    { machineId: machine.machineId, projects: pending },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  async function register(): Promise<void> {
    const entries = pickedFor(machine.machineId).map((project) => ({ project: project.name }));
    if (entries.length === 0) {
      toast.push("至少选一个项目", "danger");
      return;
    }
    setSubmitting(true);
    try {
      await confirmAgents(machine.machineId, entries);
      toast.push(`已登记 ${entries.length} 个 Agent`, "positive");
      onRegistered();
    } catch (caught) {
      toast.push(caught instanceof ApiError ? caught.message : "登记失败", "danger");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <li className={styles.machineRow}>
      <div className={styles.machineIdentity}>
        <span className={styles.machineName}>
          {machine.displayName ?? machine.hostname}
        </span>
        <span className={styles.machineSub}>
          {machine.machineId} · 心跳 {heartbeat} · 发现 {discovered}
          {machine.displayName === null || machine.displayName === machine.hostname
            ? ""
            : ` · 主机名 ${machine.hostname}`}
        </span>
      </div>
      <div className={styles.machineTags}>
        <span className={styles.machineSub}>
          项目 {machine.projects.length} 个（已登记 {confirmed}）
        </span>
        <Badge tone={tone} text={label} />
        <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
          改名
        </Button>
      </div>
      {renaming ? (
        <MachineRenameDialog
          machine={{
            id: machine.machineId,
            hostname: machine.hostname,
            displayName: machine.displayName,
          }}
          onClose={() => setRenaming(false)}
          onSaved={onRegistered}
        />
      ) : null}
      {pending.length > 0 ? (
        <div className={styles.machineProjects}>
          <span className={styles.machineSub}>待登记项目</span>
          <ul className={styles.projectList}>
            {pending.map((project) => (
              <li key={project.name}>
                <label className={styles.projectCheck}>
                  <input
                    type="checkbox"
                    checked={isChecked(machine.machineId, project.name)}
                    onChange={(event) =>
                      toggle(machine.machineId, project.name, event.target.checked)
                    }
                  />
                  <span>
                    {project.name}
                    {project.feishuBotName === undefined ? null : (
                      <span className={styles.machineSub}> · {project.feishuBotName}</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <Button
            variant="primary"
            size="sm"
            loading={submitting}
            onClick={() => void register()}
          >
            登记为 Agent
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** 第 3 步下半：已上线机器清单。执行机每轮心跳都会回报，控制台按轮询刷新。 */
export function OnlineMachines() {
  const client = useQueryClient();
  const machines = useQuery({
    queryKey: ["discovery"],
    queryFn: fetchDiscovery,
    refetchInterval: 10_000,
  });

  const list = machines.data?.machines ?? [];

  return (
    <Panel
      title="已上线执行机"
      description="执行机 enroll 成功后开始上报心跳，这里按机器维度列出状态与发现到的项目。"
    >
      {machines.isPending ? <LoadingState label="读取执行机列表…" /> : null}

      {machines.isError ? (
        <ErrorState
          message="读取执行机列表失败，稍后自动重试。"
          onRetry={() => {
            void machines.refetch();
          }}
        />
      ) : null}

      {!machines.isPending && !machines.isError && list.length === 0 ? (
        <EmptyState
          title="还没有执行机上线"
          description="在目标机跑完安装命令并完成 enroll 后，这里会立刻出现该机器。"
        />
      ) : null}

      {!machines.isPending && !machines.isError && list.length > 0 ? (
        <ul className={styles.machineList}>
          {list.map((machine) => (
            <MachineRow
              key={machine.machineId}
              machine={machine}
              onRegistered={() => {
                void client.invalidateQueries({ queryKey: ["discovery"] });
              }}
            />
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
