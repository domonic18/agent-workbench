import { type FormEvent, useState } from "react";
import { CONSOLE_PASSWORD_MIN_LENGTH } from "@shared/constants.js";
import { changePassword } from "../../api/auth.js";
import { ApiError } from "../../api/client.js";
import { Button } from "../ui/Button.js";
import { Dialog } from "../ui/Dialog.js";
import { Field, Input } from "../ui/Field.js";
import { useToast } from "../ui/Toast.js";
import styles from "./IdentityForm.module.css";

export interface ChangePasswordDialogProps {
  onClose: () => void;
}

/** 修改管理员口令:改完当前设备照常在用,其他设备会话被吊销 */
export function ChangePasswordDialog({ onClose }: ChangePasswordDialogProps) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (next.length < CONSOLE_PASSWORD_MIN_LENGTH) {
      setError(`新口令至少 ${CONSOLE_PASSWORD_MIN_LENGTH} 位`);
      return;
    }
    if (next !== confirm) {
      setError("两次输入的新口令不一致");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await changePassword(current, next);
      toast.push(
        result.revokedSessions > 0
          ? `口令已更新,已吊销 ${result.revokedSessions} 个其他设备的登录态`
          : "口令已更新",
        "positive",
      );
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "修改口令失败,请稍后再试");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog title="修改管理员口令" onClose={onClose}>
      <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
        <p className={styles.hint}>
          改完口令后,其他已登录的设备需要重新登录;当前这台设备不会被踢下线。
        </p>
        <Field label="当前口令" htmlFor="current-password" required>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            required
          />
        </Field>
        <Field
          label="新口令"
          htmlFor="new-password"
          hint={`至少 ${CONSOLE_PASSWORD_MIN_LENGTH} 位`}
          required
        >
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            required
          />
        </Field>
        <Field label="确认新口令" htmlFor="confirm-password" required>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
          />
        </Field>
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            {pending ? "提交中…" : "修改口令"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
