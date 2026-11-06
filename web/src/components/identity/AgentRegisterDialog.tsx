import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError } from "../../api/client.js";
import {
  type AgentSecret,
  createAgent,
  type CreateAgentInput,
  fetchMachines,
} from "../../api/identity.js";
import type { AgentRuntime } from "../../api/types.js";
import { RUNTIME_LABEL } from "../../shared/labels.js";
import { agentEnvHints } from "./envHints.js";
import styles from "./IdentityForm.module.css";
import { Button } from "../ui/Button.js";
import { Dialog } from "../ui/Dialog.js";
import { Field, Input, Select } from "../ui/Field.js";
import { SecretReveal } from "./SecretReveal.js";

export interface AgentRegisterDialogProps {
  onClose: () => void;
}

/** 外部运行时:没有 aw-node,只登记归属机器 */
const EXTERNAL_RUNTIMES: AgentRuntime[] = ["workbuddy", "codex", "deepseek"];

export function AgentRegisterDialog({ onClose }: AgentRegisterDialogProps) {
  const machines = useQuery({ queryKey: ["machines"], queryFn: fetchMachines });
  const [runtime, setRuntime] = useState<AgentRuntime>("claude_code");
  const [machineId, setMachineId] = useState("");
  const [project, setProject] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [key, setKey] = useState("");
  const [feishuAppId, setFeishuAppId] = useState("");
  const [allowedTargets, setAllowedTargets] = useState("");
  const [created, setCreated] = useState<AgentSecret | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const external = EXTERNAL_RUNTIMES.includes(runtime);
  const machineList = machines.data ?? [];

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (runtime === "claude_code" && machineId === "") {
      setError("请选择机器");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const input: CreateAgentInput = {
        project: project.trim(),
        displayName: displayName.trim(),
      };
      if (external) {
        input.runtime = runtime;
        if (machineId !== "") {
          input.machineId = machineId;
        }
        if (key.trim() !== "") {
          input.key = key.trim();
        }
      } else {
        input.machineId = machineId;
      }
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
    <Dialog
      title={created === null ? "注册 Agent" : "Agent 已注册"}
      onClose={onClose}
      dismissible={created === null}
    >
      {created === null ? (
        <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          <Field
            label="运行时"
            htmlFor="agent-runtime"
            hint={
              external
                ? "外部运行时不由 aw-node 调度，过程数据固定显示「未接入」。"
                : "Claude Code 由该机的 aw-node 采集与调度。"
            }
          >
            <Select
              id="agent-runtime"
              value={runtime}
              onChange={(event) => setRuntime(event.target.value as AgentRuntime)}
            >
              <option value="claude_code">{RUNTIME_LABEL.claude_code}</option>
              {EXTERNAL_RUNTIMES.map((value) => (
                <option key={value} value={value}>
                  {RUNTIME_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="机器"
            htmlFor="agent-machine"
            required={!external}
            hint={
              external
                ? "Claude Code 必选：选择已接入的执行机；外部运行时可不绑定"
                : "选择已接入的执行机"
            }
            error={
              machines.isError
                ? "机器列表加载失败，请先到「接入执行机」页完成安装。"
                : machines.data !== undefined && machineList.length === 0
                  ? "还没有已接入的执行机。请先到「接入执行机」页完成安装，执行机会自动登记。"
                  : null
            }
          >
            <Select
              id="agent-machine"
              value={machineId}
              onChange={(event) => setMachineId(event.target.value)}
              required={!external}
            >
              <option value="">
                {external ? "不绑定机器" : "选择已接入的执行机"}
              </option>
              {machineList.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.displayName}（{machine.id}）
                </option>
              ))}
            </Select>
          </Field>

          <Field label="显示名" htmlFor="agent-display-name" required>
            <Input
              id="agent-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="控制台里的名称，飞书 bot 名字回写后以 bot 名为准"
              required
            />
          </Field>

          <Field label="项目" htmlFor="agent-project" required>
            <Input
              id="agent-project"
              value={project}
              onChange={(event) => setProject(event.target.value)}
              placeholder="cc-connect 项目名，如 cc-sysdev（路由 key 默认取它）"
              required
            />
          </Field>

          {external ? (
            <Field label="路由 key（可选）" htmlFor="agent-key">
              <Input
                id="agent-key"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="Git 项目注册表引用该 Agent 用的稳定键，如 a2a-real-workbuddy"
              />
            </Field>
          ) : null}

          <Field label="飞书 App ID（可选）" htmlFor="agent-feishu-app">
            <Input
              id="agent-feishu-app"
              value={feishuAppId}
              onChange={(event) => setFeishuAppId(event.target.value)}
              placeholder="飞书自建应用的 App ID（cli_xxx），留空表示不绑定应用"
            />
          </Field>

          <Field label="可委派目标（可选）" htmlFor="agent-targets">
            <Input
              id="agent-targets"
              value={allowedTargets}
              onChange={(event) => setAllowedTargets(event.target.value)}
              placeholder="可委派的目标 Agent ID，多个用英文逗号分隔"
            />
          </Field>

          {error === null ? null : (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <div className={styles.actions}>
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {pending ? "注册中…" : "注册"}
            </Button>
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
            <Button variant="primary" onClick={onClose}>
              我已保存，关闭
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
