import { useState } from "react";
import { ApiError } from "../../api/client.js";
import { rotateAgentKey } from "../../api/identity.js";
import { agentEnvHints } from "./envHints.js";
import { Button } from "../ui/Button.js";
import { Dialog } from "../ui/Dialog.js";
import { SecretReveal } from "./SecretReveal.js";

export interface AgentRotateDialogProps {
  agent: { id: string; displayName: string; project: string };
  onClose: () => void;
  /** 轮换成功后回传明文密钥：调用方据此出配置片段 */
  onRotated?: (secret: string) => void;
}

export function AgentRotateDialog({ agent, onClose, onRotated }: AgentRotateDialogProps) {
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleRotate(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const result = await rotateAgentKey(agent.id);
      setSecret(result.secret);
      onRotated?.(result.secret);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "密钥轮换失败，请稍后再试");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog title={secret === null ? "轮换 Agent 密钥" : "新密钥已生成"} onClose={onClose} dismissible={secret === null}>
      {secret === null ? (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-xs text-muted">
            {agent.displayName}（{agent.project}，{agent.id}）
          </p>
          <p className="m-0 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning">
            轮换后旧密钥立即失效。正在用旧密钥连接的 Agent 会断开，需要把新密钥写进它的 MCP
            客户端配置后重连。
          </p>
          {error === null ? null : (
            <p className="m-0 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="mt-1 flex justify-end gap-2 max-md:flex-col-reverse">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => void handleRotate()}
            >
              {pending ? "轮换中…" : "轮换密钥"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <SecretReveal
            secret={secret}
            note={`请把新密钥写进 ${agent.id} 的 MCP 客户端配置；端点与鉴权头见「协作接入」页。`}
            hints={agentEnvHints(agent.id)}
          />
          <div className="mt-1 flex justify-end gap-2 max-md:flex-col-reverse">
            <Button variant="primary" onClick={onClose}>
              我已保存，关闭
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
