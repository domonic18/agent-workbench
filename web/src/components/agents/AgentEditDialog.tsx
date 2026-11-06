import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../../api/client.js";
import { refreshBotNames } from "../../api/bootstrap.js";
import {
  fetchAgents,
  fetchMachines,
  rotateAgentKey,
  updateAgent,
} from "../../api/identity.js";
import { RUNTIME_LABEL } from "../../shared/labels.js";
import { Button } from "../ui/Button.js";
import { Dialog } from "../ui/Dialog.js";
import { Field, Input, Select } from "../ui/Field.js";
import { useToast } from "../ui/Toast.js";
import { AgentTargetsSection } from "./AgentTargetsSection.js";
import { AgentUsageLimitSection } from "./AgentUsageLimitSection.js";
import styles from "./agents.module.css";

export interface AgentEditDialogProps {
  agentId: string;
  onClose: () => void;
  /** 请求删除：由外层切换到删除确认，避免两个弹窗叠在一起 */
  onRequestDelete: (agentId: string) => void;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function AgentEditDialog({
  agentId,
  onClose,
  onRequestDelete,
}: AgentEditDialogProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });
  const machinesQuery = useQuery({ queryKey: ["machines"], queryFn: fetchMachines });
  const agent = agentsQuery.data?.find((item) => item.id === agentId);

  const [displayName, setDisplayName] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  /** undefined = 未改动;null = 解绑 */
  const [machineId, setMachineId] = useState<string | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const name = displayName ?? agent?.displayName ?? "";
  const target = project ?? agent?.project ?? "";

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ["agents"], exact: true });
  }

  async function saveProfile(): Promise<void> {
    if (agent === undefined) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await updateAgent(agent.id, { displayName: name.trim(), project: target.trim() });
      toast.push("档案已保存", "positive");
      setDisplayName(null);
      setProject(null);
      await refresh();
    } catch (caught) {
      setError(messageOf(caught, "保存失败，请稍后再试"));
    } finally {
      setPending(false);
    }
  }

  async function toggleStatus(): Promise<void> {
    if (agent === undefined) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const next = agent.status === "active" ? "disabled" : "active";
      await updateAgent(agent.id, { status: next });
      toast.push(next === "active" ? "已启用该 Agent" : "已停用该 Agent", "positive");
      await refresh();
    } catch (caught) {
      setError(messageOf(caught, "状态更新失败，请稍后再试"));
    } finally {
      setPending(false);
    }
  }

  async function rotate(): Promise<void> {
    if (agent === undefined) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await rotateAgentKey(agent.id);
      setRotatedSecret(result.secret);
      setConfirmRotate(false);
      toast.push("新密钥已生成", "positive");
    } catch (caught) {
      setError(messageOf(caught, "密钥轮换失败，请稍后再试"));
    } finally {
      setPending(false);
    }
  }

  async function refreshBotName(): Promise<void> {
    if (agent === undefined || agent.machineId === null) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await refreshBotNames(agent.machineId);
      toast.push("已请求刷新飞书 bot 名，约 1 分钟内生效", "positive");
    } catch (caught) {
      setError(messageOf(caught, "刷新请求失败，请稍后再试"));
    } finally {
      setPending(false);
    }
  }

  /** 绑定/解绑宿主机器:只登记归属,不改密钥与路由 key */
  async function saveMachine(): Promise<void> {
    if (agent === undefined || machineId === undefined) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await updateAgent(agent.id, { machineId });
      toast.push(machineId === null ? "已解绑机器" : "已绑定机器", "positive");
      setMachineId(undefined);
      await refresh();
    } catch (caught) {
      setError(messageOf(caught, "绑定机器失败，请稍后再试"));
    } finally {
      setPending(false);
    }
  }

  if (agentsQuery.isPending) {
    return (
      <Dialog title="管理 Agent" onClose={onClose}>
        <p className={styles.muted}>加载中…</p>
      </Dialog>
    );
  }

  if (agent === undefined) {
    return (
      <Dialog title="管理 Agent" onClose={onClose}>
        <p className={styles.error} role="alert">
          该 Agent 已不存在，可能已被删除。
        </p>
      </Dialog>
    );
  }

  const profileDirty = name !== agent.displayName || target !== agent.project;

  return (
    <Dialog
      title="管理 Agent"
      description={`${agent.displayName}（${agent.project}）· ${agent.id}`}
      size="lg"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          完成
        </Button>
      }
    >
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>档案</h3>
        <p className={styles.sectionHint}>
          显示名与项目决定控制台里的身份标识；改名不影响已跑起来的历史记录。
        </p>
        <div className={styles.fieldGrid}>
          <Field label="显示名" htmlFor="agent-display-name">
            <Input
              id="agent-display-name"
              value={name}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          <Field label="项目" htmlFor="agent-project">
            <Input
              id="agent-project"
              value={target}
              onChange={(event) => setProject(event.target.value)}
            />
          </Field>
        </div>
        <div className={styles.rowActionsLeft}>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !profileDirty || name.trim() === "" || target.trim() === ""}
            onClick={() => void saveProfile()}
          >
            {pending ? "保存中…" : "保存档案"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => void toggleStatus()}
          >
            {agent.status === "active" ? "停用" : "启用"}
          </Button>
          {agent.machineId === null ? null : (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => void refreshBotName()}
            >
              刷新飞书 bot 名
            </Button>
          )}
        </div>
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </section>

      <AgentTargetsSection agent={agent} allAgents={agentsQuery.data ?? []} onSaved={() => void refresh()} />
      <AgentUsageLimitSection agent={agent} onSaved={() => void refresh()} />

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>运行归属</h3>
        <p className={styles.sectionHint}>
          {agent.runtime === "claude_code"
            ? "Claude Code 由该机的 aw-node 采集与调度，机器由初始化确认流程决定，不能在此改。"
            : "外部运行时只登记「跑在哪台机器上」：该机不会接管它的过程数据，绑定后可按机器与项目匹配飞书 bot 名。"}
        </p>
        <div className={styles.fieldGrid}>
          <Field label="运行时" htmlFor="agent-runtime">
            <Input id="agent-runtime" readOnly value={RUNTIME_LABEL[agent.runtime]} />
          </Field>
          {agent.runtime === "claude_code" ? (
            <Field label="宿主机器" htmlFor="agent-machine-readonly">
              <Input
                id="agent-machine-readonly"
                readOnly
                value={agent.machineId ?? "未绑定"}
              />
            </Field>
          ) : (
            <Field label="宿主机器" htmlFor="agent-machine" hint="可留空；留空表示不绑定任何机器。">
              <Select
                id="agent-machine"
                value={machineId === undefined ? (agent.machineId ?? "") : (machineId ?? "")}
                onChange={(event) =>
                  setMachineId(event.target.value === "" ? null : event.target.value)
                }
              >
                <option value="">不绑定机器</option>
                {(machinesQuery.data ?? []).map((machine) => (
                  <option key={machine.id} value={machine.id}>
                    {machine.displayName}（{machine.id}）
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {agent.runtime === "claude_code" ? null : (
          <div className={styles.rowActionsLeft}>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || machineId === undefined || machineId === agent.machineId}
              onClick={() => void saveMachine()}
            >
              {pending ? "保存中…" : "保存归属"}
            </Button>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>密钥</h3>
        <p className={styles.sectionHint}>
          轮换后旧密钥立即失效，正在运行的 Agent 会断开，需要把新密钥写入其运行环境后重启。
        </p>
        {rotatedSecret === null ? (
          <div className={styles.rowActionsLeft}>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirmRotate(true)}
            >
              轮换密钥
            </Button>
            {confirmRotate ? (
              <>
                <span className={styles.muted}>确认轮换？旧密钥会立刻失效。</span>
                <Button size="sm" variant="danger" loading={pending} onClick={() => void rotate()}>
                  确认轮换
                </Button>
              </>
            ) : null}
          </div>
        ) : (
          <div className={styles.fieldGrid}>
            <div className={styles.fieldFull}>
              <Field label="新密钥（只显示这一次）" htmlFor="rotated-secret">
                <Input id="rotated-secret" readOnly value={rotatedSecret} />
              </Field>
            </div>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>危险操作</h3>
        <div className={styles.dangerZone}>
          <p className={styles.sectionHint}>
            删除不可逆：会级联清理该 Agent 的收件箱、整条 A2A 线程、运行记录与 Token 账目，历史任务保留。
          </p>
          <Button
            size="sm"
            variant="danger"
            onClick={() => onRequestDelete(agent.id)}
          >
            删除该 Agent
          </Button>
        </div>
      </section>
    </Dialog>
  );
}
