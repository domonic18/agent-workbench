import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../../api/client.js";
import { confirmAgents, fetchDiscovery } from "../../../api/bootstrap.js";
import { formatRelativeTime } from "../../../shared/format.js";
import { useProjectSelection } from "../../machines/useProjectSelection.js";
import { Button } from "../../ui/Button.js";
import { Feedback } from "../Feedback.js";

export function StepProjects() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const discovery = useQuery({
    queryKey: ["bootstrap", "discovery"],
    queryFn: fetchDiscovery,
    refetchInterval: 4000,
  });

  const machines = discovery.data?.machines ?? [];
  // 按机器分组：Agent 绑定的是机器，跨机项目不能并到同一台机去确认
  const { pickedFor, pickedCount, toggle, isChecked } = useProjectSelection(
    machines.map((machine) => ({ machineId: machine.machineId, projects: machine.projects })),
  );

  async function confirm(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      for (const machine of machines) {
        const picked = pickedFor(machine.machineId);
        if (picked.length === 0) {
          continue;
        }
        await confirmAgents(
          machine.machineId,
          picked.map((project) => ({ project: project.name })),
        );
      }
      setConfirmed(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "确认失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full bg-surface border border-border rounded-lg p-6 shadow-sm max-md:[&_input]:min-h-touch max-md:[&_select]:min-h-touch max-md:[&_button]:min-h-touch">
      <h1 className="m-0 mb-1 text-xl font-semibold">添加项目</h1>
      <p className="text-muted m-0 mb-5 text-md">
        确认执行机上报的 cc-connect 项目,控制台据此创建主责 Agent 并下发不含明文 Bearer 的运行时配置。
      </p>
      {machines.length === 0 ? (
        <p className="text-muted text-xs mt-2">尚未检测到执行机上报的发现结果…</p>
      ) : (
        machines.map((machine) => (
          <div key={machine.machineId} className="mt-4 border border-border rounded-md p-4">
            <strong>{machine.displayName ?? machine.hostname}</strong>
            <span className="text-muted text-xs mt-2">
              {machine.machineId} · 心跳{" "}
              {machine.lastSeenAt === null ? "未上报" : formatRelativeTime(machine.lastSeenAt)}
            </span>
            {machine.projects.map((project) => (
              <label key={project.name} className="flex items-center gap-3 py-1 text-md">
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
                    <span className="text-muted text-xs mt-2"> · {project.feishuBotName}</span>
                  )}
                  {project.cwd === undefined ? null : <span className="text-muted text-xs mt-2"> · {project.cwd}</span>}
                </span>
              </label>
            ))}
          </div>
        ))
      )}
      {machines.length > 0 && pickedCount === 0 ? (
        <p className="text-muted text-xs mt-2">执行机尚未上报可确认的项目,请确认目标机已配置 cc-connect。</p>
      ) : null}
      <div className="flex flex-col items-stretch gap-4">
        <Button
          variant="primary"
          size="lg"
          onClick={() => void confirm()}
          disabled={pending || pickedCount === 0}
        >
          {pending ? "确认中…" : confirmed ? "已确认,等待配置下发" : "确认项目与主责 Agent"}
        </Button>
      </div>
      {confirmed ? <p className="text-muted text-xs mt-2">aw-node 将自动拉取配置并回执,完成后进入下一步。</p> : null}
      <Feedback error={error} />
    </div>
  );
}
