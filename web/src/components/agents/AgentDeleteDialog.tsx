import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../../api/client.js";
import {
  deleteAgent,
  fetchAgentDeleteImpact,
  fetchAgents,
  type AgentDeletionPreview,
} from "../../api/identity.js";
import { Button } from "../ui/Button.js";
import { Dialog } from "../ui/Dialog.js";
import { Field, Select } from "../ui/Field.js";
import { useToast } from "../ui/Toast.js";
import styles from "./agents.module.css";

export interface AgentDeleteDialogProps {
  agentId: string;
  onClose: () => void;
  onDeleted: () => void;
}

const DESTROYED_LABELS: [keyof AgentDeletionPreview["impact"]["destroyed"], string][] = [
  ["workerInbox", "收件箱派工行"],
  ["a2aThread", "A2A 线程（整条）"],
  ["a2aMessage", "A2A 消息（整条线程内）"],
  ["a2aDeadLetter", "投递死信"],
  ["outboxPull", "未终态投递"],
  ["agentRun", "运行记录"],
  ["timelineEvent", "时间线事件"],
  ["tokenUsage", "Token 账目"],
  ["usageLimit", "用量上限"],
];

const DETACHED_LABELS: [keyof AgentDeletionPreview["impact"]["detached"], string][] = [
  ["workTrigger", "工作触发器（置空）"],
  ["knowledgeEntry", "知识条目（置空）"],
];

const RETAINED_LABELS: [keyof AgentDeletionPreview["impact"]["retained"], string][] = [
  ["task", "任务记录"],
  ["toolCallLog", "工具调用日志"],
  ["workItem", "工作事项"],
];

export function AgentDeleteDialog({
  agentId,
  onClose,
  onDeleted,
}: AgentDeleteDialogProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [successor, setSuccessor] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });
  const agent = agentsQuery.data?.find((item) => item.id === agentId);
  const candidates = (agentsQuery.data ?? []).filter(
    (item) => item.id !== agentId && item.status === "active",
  );

  const impactQuery = useQuery({
    queryKey: ["agents", agentId, "delete-impact"],
    queryFn: () => fetchAgentDeleteImpact(agentId),
  });
  const preview = impactQuery.data?.preview;

  async function confirm(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await deleteAgent(
        agentId,
        successor === "" ? {} : { reassignBootstrapPrimaryTo: successor },
      );
      toast.push(`${agent?.displayName ?? agentId} 已删除`, "positive");
      await queryClient.invalidateQueries({ queryKey: ["agents"], exact: true });
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
      onDeleted();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "删除失败，请稍后再试");
    } finally {
      setPending(false);
    }
  }

  const needsSuccessor = preview?.bootstrapPrimary === true;
  const blocked = needsSuccessor && successor === "";

  return (
    <Dialog
      title="删除 Agent"
      description={
        agent === undefined
          ? agentId
          : `${agent.displayName}（${agent.project}，${agent.id}）`
      }
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="danger" disabled={blocked} loading={pending} onClick={() => void confirm()}>
            确认删除
          </Button>
        </>
      }
    >
      {impactQuery.isPending ? <p className={styles.muted}>正在核对影响范围…</p> : null}

      {impactQuery.isError ? (
        <p className={styles.error} role="alert">
          {impactQuery.error instanceof ApiError
            ? impactQuery.error.message
            : "影响范围读取失败"}
        </p>
      ) : null}

      {preview === undefined ? null : (
        <>
          <p className={styles.dangerNote}>
            删除不可逆：以下内容会随该 Agent 一起消失，界面上无法恢复。
          </p>
          <div className={styles.impact}>
            <div className={styles.impactGroup}>
              <div className={styles.impactGroupTitle}>将被删除</div>
              <ul className={styles.impactList}>
                {DESTROYED_LABELS.map(([key, label]) => (
                  <li key={key}>
                    <span>{label}</span>
                    <span className={styles.impactCount}>{preview.impact.destroyed[key]}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.impactGroup}>
              <div className={styles.impactGroupTitle}>将置空引用</div>
              <ul className={styles.impactList}>
                {DETACHED_LABELS.map(([key, label]) => (
                  <li key={key}>
                    <span>{label}</span>
                    <span className={styles.impactCount}>{preview.impact.detached[key]}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.impactGroup}>
              <div className={styles.impactGroupTitle}>保留</div>
              <ul className={styles.impactList}>
                {RETAINED_LABELS.map(([key, label]) => (
                  <li key={key}>
                    <span>{label}</span>
                    <span className={styles.impactCount}>{preview.impact.retained[key]}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {needsSuccessor ? (
            <Field
              label="指定接替的默认 bug_fix 主责"
              htmlFor="delete-successor"
              required
              hint="该 Agent 是默认 bug_fix 路由的主责，必须先指定接替者，删除才会放行。"
            >
              <Select
                id="delete-successor"
                value={successor}
                onChange={(event) => setSuccessor(event.target.value)}
              >
                <option value="">请选择接替者…</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.displayName}（{candidate.project}）
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </>
      )}

      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
