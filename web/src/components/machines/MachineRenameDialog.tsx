import { useState } from "react";
import { ApiError } from "../../api/client.js";
import { updateMachine } from "../../api/identity.js";
import { Button } from "../ui/Button.js";
import { Dialog } from "../ui/Dialog.js";
import { Field, Input } from "../ui/Field.js";
import { useToast } from "../ui/Toast.js";

export interface MachineRenameDialogProps {
  machine: { id: string; hostname: string; displayName: string | null };
  onClose: () => void;
  onSaved: () => void;
}

/**
 * 改机器展示名:主机名登记成 IP 时给一个人能认的名字。
 * hostname 是 enroll 去重键,服务端只改 display_name,重装机器不会多出一行。
 */
export function MachineRenameDialog({ machine, onClose, onSaved }: MachineRenameDialogProps) {
  const toast = useToast();
  const [name, setName] = useState(machine.displayName ?? machine.hostname);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("显示名不能为空");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await updateMachine(machine.id, { displayName: trimmed });
      toast.push("机器显示名已更新", "positive");
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "改名失败，请稍后再试");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      title="改机器显示名"
      description={`主机名 ${machine.hostname} · ${machine.id}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={pending} onClick={() => void save()}>
            保存
          </Button>
        </>
      }
    >
      <Field
        label="显示名"
        htmlFor="machine-display-name"
        hint="只影响控制台展示;主机名与采集器配置不变。"
        error={error}
      >
        <Input
          id="machine-display-name"
          value={name}
          maxLength={128}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}
