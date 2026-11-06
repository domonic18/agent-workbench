import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../../api/client.js";
import { confirmAgents, fetchDiscovery } from "../../../api/bootstrap.js";
import { formatRelativeTime } from "../../../shared/format.js";
import { useProjectSelection } from "../../machines/useProjectSelection.js";
import { Feedback } from "../Feedback.js";
import styles from "../setup.module.css";

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
    <div className={styles.card}>
      <h1 className={styles.title}>添加项目</h1>
      <p className={styles.description}>
        确认执行机上报的 cc-connect 项目,控制台据此创建主责 Agent 并下发不含明文 Bearer 的运行时配置。
      </p>
      {machines.length === 0 ? (
        <p className={styles.hint}>尚未检测到执行机上报的发现结果…</p>
      ) : (
        machines.map((machine) => (
          <div key={machine.machineId} className={styles.section}>
            <strong>{machine.hostname}</strong>
            <span className={styles.hint}>
              {machine.machineId} · 心跳{" "}
              {machine.lastSeenAt === null ? "未上报" : formatRelativeTime(machine.lastSeenAt)}
            </span>
            {machine.projects.map((project) => (
              <label key={project.name} className={styles.project}>
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
                    <span className={styles.hint}> · {project.feishuBotName}</span>
                  )}
                  {project.cwd === undefined ? null : <span className={styles.hint}> · {project.cwd}</span>}
                </span>
              </label>
            ))}
          </div>
        ))
      )}
      {machines.length > 0 && pickedCount === 0 ? (
        <p className={styles.hint}>执行机尚未上报可确认的项目,请确认目标机已配置 cc-connect。</p>
      ) : null}
      <button
        className={styles.button}
        onClick={() => void confirm()}
        disabled={pending || pickedCount === 0}
      >
        {pending ? "确认中…" : confirmed ? "已确认,等待配置下发" : "确认项目与主责 Agent"}
      </button>
      {confirmed ? <p className={styles.hint}>aw-node 将自动拉取配置并回执,完成后进入下一步。</p> : null}
      <Feedback error={error} />
    </div>
  );
}
