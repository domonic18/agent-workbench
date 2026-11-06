import { type FormEvent, useState } from "react";
import { ApiError } from "../../api/client.js";
import { createMachine, type MachineSecret } from "../../api/identity.js";
import { machineEnvHints } from "./envHints.js";
import styles from "./IdentityForm.module.css";
import { Dialog } from "../ui/Dialog.js";
import { SecretReveal } from "./SecretReveal.js";

export interface MachineRegisterDialogProps {
  onClose: () => void;
}

export function MachineRegisterDialog({ onClose }: MachineRegisterDialogProps) {
  const [collectorId, setCollectorId] = useState("");
  const [hostname, setHostname] = useState("");
  const [os, setOs] = useState("");
  const [collectorVersion, setCollectorVersion] = useState("");
  const [created, setCreated] = useState<MachineSecret | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      setCreated(
        await createMachine({
          id: collectorId.trim(),
          hostname: hostname.trim(),
          os: os.trim(),
          collectorVersion: collectorVersion.trim(),
        }),
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "机器登记失败，请稍后再试");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      title={created === null ? "机器登记" : "机器已登记"}
      onClose={onClose}
      dismissible={created === null}
    >
      {created === null ? (
        <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          <p className={styles.hint}>
            项目归属不会自动生效：登记完成后，请在总览里用「注册 Agent」为本机逐条确认机器与项目，
            否则该机推送的流按未归因处理。
          </p>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="machine-collector-id">
              collector_id
            </label>
            <input
              id="machine-collector-id"
              className={styles.input}
              value={collectorId}
              onChange={(event) => setCollectorId(event.target.value)}
              placeholder="采集器身份，例如 macmini-01"
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="machine-hostname">
              主机名
            </label>
            <input
              id="machine-hostname"
              className={styles.input}
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="machine-os">
              操作系统
            </label>
            <input
              id="machine-os"
              className={styles.input}
              value={os}
              onChange={(event) => setOs(event.target.value)}
              placeholder="例如 macOS 15"
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="machine-collector-version">
              采集器版本
            </label>
            <input
              id="machine-collector-version"
              className={styles.input}
              value={collectorVersion}
              onChange={(event) => setCollectorVersion(event.target.value)}
              required
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
              {pending ? "登记中…" : "登记"}
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.form}>
          <p className={styles.hint}>
            {created.machine.hostname}（{created.machine.id}）已登记。
          </p>
          <SecretReveal
            secret={created.secret}
            note="把密钥写入该机采集器的运行环境。"
            hints={machineEnvHints(created.machine.id)}
          />
          <div className={styles.actions}>
            <button type="button" className={styles.submit} onClick={onClose}>
              我已保存，关闭
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
