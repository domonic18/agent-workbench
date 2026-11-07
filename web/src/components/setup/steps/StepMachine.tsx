import { type BootstrapStatus } from "../../../api/bootstrap.js";
import { DownloadStep } from "../../onboarding/DownloadStep.js";
import { InstallStep } from "../../onboarding/InstallStep.js";
import { OnlineMachines } from "../../onboarding/OnlineMachines.js";
import { useEnrollToken } from "../../onboarding/useEnrollToken.js";
import styles from "../setup.module.css";

/** /setup 第 2 步：接入执行机。复用 /onboarding 的同一套组件，两处不各写一份。 */
export function StepMachine({ status }: { status: BootstrapStatus }) {
  const enroll = useEnrollToken();
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <>
      <div className={styles.card}>
        <h1 className={styles.title}>添加执行机</h1>
        <p className={styles.description}>
          在目标机执行安装命令,按提示粘贴一次性 enroll token(输入不回显)。控制台据此换取机器 ID、安装并启动 aw-node。
        </p>
        {status.machines > 0 ? (
          <p className={styles.hint}>已检测到 {status.machines} 台执行机,可进入下一步。</p>
        ) : (
          <p className={styles.hint}>等待执行机上线并回报心跳…</p>
        )}
      </div>
      <DownloadStep origin={origin} />
      <InstallStep origin={origin} enroll={enroll} />
      <OnlineMachines />
    </>
  );
}
