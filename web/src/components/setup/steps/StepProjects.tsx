import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../../api/client.js";
import { confirmAgents, fetchDiscovery } from "../../../api/bootstrap.js";
import { Feedback } from "../Feedback.js";
import styles from "../setup.module.css";

export function StepProjects() {
  const [selected, setSelected] = useState<Record<string, Record<string, boolean>>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const discovery = useQuery({
    queryKey: ["bootstrap", "discovery"],
    queryFn: fetchDiscovery,
    refetchInterval: 4000,
  });

  const machines = discovery.data?.machines ?? [];
  const picked = useMemo(
    () => machines.flatMap((machine) =>
      machine.projects.filter((project) => selected[machine.machineId]?.[project.name] !== false),
    ),
    [machines, selected],
  );

  function toggle(machineId: string, name: string, value: boolean): void {
    setSelected((prev) => ({
      ...prev,
      [machineId]: { ...(prev[machineId] ?? {}), [name]: value },
    }));
  }

  async function confirm(): Promise<void> {
    setPending(true);
    setError(null);
    const machineId = machines[0]?.machineId;
    if (machineId === undefined) {
      setError("尚未检测到执行机,请先完成上一步");
      setPending(false);
      return;
    }
    try {
      await confirmAgents(
        machineId,
        picked.map((project) => ({ project: project.name })),
      );
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
            {machine.projects.map((project) => (
              <label key={project.name} className={styles.project}>
                <input
                  type="checkbox"
                  checked={selected[machine.machineId]?.[project.name] !== false}
                  onChange={(event) => toggle(machine.machineId, project.name, event.target.checked)}
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
      {machines.length > 0 && picked.length === 0 ? (
        <p className={styles.hint}>执行机尚未上报可确认的项目,请确认目标机已配置 cc-connect。</p>
      ) : null}
      <button
        className={styles.button}
        onClick={() => void confirm()}
        disabled={pending || picked.length === 0}
      >
        {pending ? "确认中…" : confirmed ? "已确认,等待配置下发" : "确认项目与主责 Agent"}
      </button>
      {confirmed ? <p className={styles.hint}>aw-node 将自动拉取配置并回执,完成后进入下一步。</p> : null}
      <Feedback error={error} />
    </div>
  );
}
