import { useState } from "react";
import { ApiError } from "../../../api/client.js";
import { issueEnrollToken, type BootstrapStatus } from "../../../api/bootstrap.js";
import { StepHeader } from "../StepHeader.js";
import { Feedback } from "../Feedback.js";
import styles from "../setup.module.css";

export function StepMachine({ step, status }: { step: number; status: BootstrapStatus }) {
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  // 令牌不进命令行参数与 shell history:脚本按提示隐藏读取,页面单独展示(04 §8)
  const installCommand = `curl -fsSL ${origin}/artifacts/install.sh | sh -s -- --url ${origin}`;

  async function issue(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const issued = await issueEnrollToken();
      setToken(issued.token);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "签发失败");
    } finally {
      setPending(false);
    }
  }

  const detected = status.machines > 0;
  return (
    <div className={styles.card}>
      <StepHeader step={step} />
      <h1 className={styles.title}>添加执行机</h1>
      <p className={styles.description}>
        在目标机执行下面的命令,按提示粘贴一次性 enroll token(输入不回显)。控制台据此换取机器 ID、安装并启动 aw-node。
      </p>
      <button className={styles.button} onClick={() => void issue()} disabled={pending}>
        {pending ? "签发中…" : token === null ? "签发 enroll token" : "重新签发"}
      </button>
      <div className={styles.section}>
        <label className={styles.label} htmlFor="install-command">
          在目标机执行
        </label>
        <textarea id="install-command" className={styles.textarea} readOnly value={installCommand} />
        {token === null ? null : (
          <>
            <label className={styles.label} htmlFor="enroll-token">
              enroll token(脚本提示时粘贴,只显示一次)
            </label>
            <textarea id="enroll-token" className={styles.textarea} readOnly value={token} />
          </>
        )}
        {detected ? (
          <p className={styles.hint}>已检测到 {status.machines} 台执行机,可进入下一步。</p>
        ) : (
          <p className={styles.hint}>等待执行机上线并回报心跳…</p>
        )}
      </div>
      <Feedback error={error} />
    </div>
  );
}
