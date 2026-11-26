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
  latestVersion,
  onRegistered,
}: {
  machine: DiscoveryMachineView;
  /** 控制台镜像的最新采集器版本;未发布产物时为 null */
  latestVersion: string | null;
  onRegistered: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const tone = STATUS_TONE[machine.status] ?? "muted";
  const label = STATUS_LABEL[machine.status] ?? machine.status;
  const confirmed = machine.projects.filter((project) => project.confirmed).length;
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
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border border-border rounded-md bg-surface-2">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-md font-semibold text-foreground">
          {machine.displayName ?? machine.hostname}
        </span>
        <span className="text-xs text-muted [overflow-wrap:anywhere]">
          {machine.machineId} · 心跳 {heartbeat} · 发现 {discovered} · 采集器 v{machine.collectorVersion}
          {machine.displayName === null || machine.displayName === machine.hostname
            ? ""
            : ` · 主机名 ${machine.hostname}`}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted [overflow-wrap:anywhere]">
          项目 {machine.projects.length} 个（已登记 {confirmed}）
        </span>
        {machine.upgradeAvailable ? (
          <Badge
            tone="warning"
            text={latestVersion === null ? "采集器可升级" : `可升级到 v${latestVersion}`}
          />
        ) : null}
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
        <div className="flex flex-col gap-2 basis-full pt-3 border-t border-border [&>button]:self-start">
          <span className="text-xs text-muted [overflow-wrap:anywhere]">待登记项目</span>
          <ul className="flex flex-wrap gap-x-4 gap-y-2 m-0 p-0 list-none">
            {pending.map((project) => (
              <li key={project.name}>
                <label className="inline-flex items-center gap-2 text-sm text-foreground cursor-pointer">
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
                      <span className="text-xs text-muted [overflow-wrap:anywhere]"> · {project.feishuBotName}</span>
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

export function OnlineMachines() {
  const client = useQueryClient();
  const machines = useQuery({
    queryKey: ["discovery"],
    queryFn: fetchDiscovery,
    refetchInterval: 10_000,
  });

  const list = machines.data?.machines ?? [];

  return (
    <Panel title="已上线执行机">
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
        <EmptyState title="还没有执行机上线" />
      ) : null}

      {!machines.isPending && !machines.isError && list.length > 0 ? (
        <ul className="flex flex-col gap-3 m-0 p-0 list-none">
          {list.map((machine) => (
            <MachineRow
              key={machine.machineId}
              machine={machine}
              latestVersion={machines.data?.latestCollectorVersion ?? null}
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
