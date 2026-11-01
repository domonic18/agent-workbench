import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError } from "../../api/client.js";
import {
  type AgentSecret,
  createAgent,
  type CreateAgentInput,
  fetchMachines,
} from "../../api/identity.js";
import { agentEnvHints } from "./envHints.js";
import styles from "./IdentityForm.module.css";
import { Modal } from "./Modal.js";
import { SecretReveal } from "./SecretReveal.js";

export interface AgentRegisterDialogProps {
  onClose: () => void;
}

export function AgentRegisterDialog({ onClose }: AgentRegisterDialogProps) {
  const machines = useQuery({ queryKey: ["machines"], queryFn: fetchMachines });
  const [machineId, setMachineId] = useState("");
  const [project, setProject] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [feishuAppId, setFeishuAppId] = useState("");
  const [allowedTargets, setAllowedTargets] = useState("");
  const [created, setCreated] = useState<AgentSecret | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (machineId === "") {
      setError("请选择机器");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const input: CreateAgentInput = {
        machineId,
        project: project.trim(),
        displayName: displayName.trim(),
      };
      if (feishuAppId.trim() !== "") {
        input.feishuAppId = feishuAppId.trim();
      }
      const targets = allowedTargets
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "");
      if (targets.length > 0) {
        input.allowedTargets = targets;
      }
      setCreated(await createAgent(input));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Agent 注册失败，请稍后再试");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      title={created === null ? "注册 Agent" : "Agent 已注册"}
      onClose={onClose}
      dismissible={created === null}
    >
      {created === null ? (
        <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="agent-machine">
              机器
            </label>
            <select
              id="agent-machine"
              className={styles.select}
              value={machineId}
              onChange={(event) => setMachineId(event.target.value)}
              required
            >
              <option value="">选择已登记的机器</option>
              {(machines.data ?? []).map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.hostname}（{machine.id}）
                </option>
              ))}
            </select>
            {machines.isPending ? <p className={styles.hint}>加载机器…</p> : null}
            {machines.isError ? (
              <p className={styles.error}>机器列表加载失败，请先完成机器登记。</p>
            ) : null}
            {machines.data !== undefined && machines.data.length === 0 ? (
              <p className={styles.hint}>还没有机器。请先用「机器登记」添加一台。</p>
            ) : null}
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="agent-project">
              项目
            </label>
            <input
              id="agent-project"
              className={styles.input}
              value={project}
              onChange={(event) => setProject(event.target.value)}
              placeholder="cc-connect 项目名"
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="agent-display-name">
              显示名
            </label>
            <input
              id="agent-display-name"
              className={styles.input}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="agent-feishu-app">
              飞书 App ID（可选）
            </label>
            <input
              id="agent-feishu-app"
              className={styles.input}
              value={feishuAppId}
              onChange={(event) => setFeishuAppId(event.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="agent-targets">
              可委派目标（可选）
            </label>
            <input
              id="agent-targets"
              className={styles.input}
              value={allowedTargets}
              onChange={(event) => setAllowedTargets(event.target.value)}
              placeholder="多个 Agent ID 用英文逗号分隔"
            />
          </div>
          {error === null ? null : (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              取消
            </button>
            <button type="submit" className={styles.submit} disabled={pending}>
              {pending ? "注册中…" : "注册"}
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.form}>
          <p className={styles.hint}>
            {created.agent.displayName}（{created.agent.project}，{created.agent.id}）已登记。
          </p>
          <SecretReveal
            secret={created.secret}
            note="把密钥写入该 Agent 的 MCP proxy 运行环境。"
            hints={agentEnvHints(created.agent.id)}
          />
          <div className={styles.actions}>
            <button type="button" className={styles.submit} onClick={onClose}>
              我已保存，关闭
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
