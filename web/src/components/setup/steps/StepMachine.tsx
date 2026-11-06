import { type BootstrapStatus } from "../../../api/bootstrap.js";
import { ExecutionSetupPanel } from "../ExecutionSetupPanel.js";
import styles from "../setup.module.css";

export function StepMachine({ status }: { status: BootstrapStatus }) {
  return (
    <div className={styles.card}>
      <h1 className={styles.title}>添加执行机</h1>
      <p className={styles.description}>
        在目标机执行下面的命令,按提示粘贴一次性 enroll token(输入不回显)。控制台据此换取机器 ID、安装并启动 aw-node。
      </p>
      <ExecutionSetupPanel />
      {status.machines > 0 ? (
        <p className={styles.hint}>已检测到 {status.machines} 台执行机,可进入下一步。</p>
      ) : (
        <p className={styles.hint}>等待执行机上线并回报心跳…</p>
      )}
    </div>
  );
}
