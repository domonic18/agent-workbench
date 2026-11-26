import { Panel } from "../ui/Panel.js";
import { CopyBlock } from "../ui/CopyBlock.js";
import { EnrollTokenPanel } from "./EnrollTokenPanel.js";
import type { EnrollTokenState } from "./useEnrollToken.js";
import styles from "./onboarding.module.css";

export interface InstallStepProps {
  origin: string;
  enroll: EnrollTokenState;
}

export function InstallStep({ origin, enroll }: InstallStepProps) {
  const installCommand = `curl -fsSL ${origin}/artifacts/install.sh | sh -s -- --url ${origin}`;
  const upgradeCommand = `curl -fsSL ${origin}/artifacts/install.sh | sh -s -- --url ${origin} --mode upgrade`;
  const manualCommand = `aw-node enroll --url ${origin}`;

  return (
    <div className={styles.stack}>
      <Panel title="按这四步装完">
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepMarker} aria-hidden="true">
              1
            </span>
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>在目标机执行安装命令</p>
              <CopyBlock
                label="在目标机执行"
                value={installCommand}
                copyLabel="复制命令"
                copiedText="安装命令已复制"
              />
            </div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepMarker} aria-hidden="true">
              2
            </span>
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>脚本提示时粘贴一次性 enroll token</p>
              <EnrollTokenPanel
                token={enroll.token}
                expiresAt={enroll.expiresAt}
                pending={enroll.pending}
                error={enroll.error}
                onIssue={() => {
                  void enroll.issue();
                }}
              />
            </div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepMarker} aria-hidden="true">
              3
            </span>
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>enroll 成功后写入 launchd 并拉起服务</p>
            </div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepMarker} aria-hidden="true">
              4
            </span>
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>自检</p>
            </div>
          </li>
        </ol>
      </Panel>

      <Panel title="覆盖安装（已加入过的机器）">
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepMarker} aria-hidden="true">
              1
            </span>
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>在目标机执行覆盖安装命令</p>
              <CopyBlock
                label="覆盖安装命令"
                value={upgradeCommand}
                copyLabel="复制命令"
                copiedText="覆盖安装命令已复制"
              />
            </div>
          </li>
        </ol>
      </Panel>

      <Panel title="手动安装（备选）">
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepMarker} aria-hidden="true">
              1
            </span>
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>下载对应平台的产物到本地</p>
            </div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepMarker} aria-hidden="true">
              2
            </span>
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>加执行权限</p>
            </div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepMarker} aria-hidden="true">
              3
            </span>
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>enroll 换机器身份</p>
              <CopyBlock
                label="在目标机执行"
                value={manualCommand}
                copyLabel="复制命令"
                copiedText="命令已复制"
              />
            </div>
          </li>
        </ol>
      </Panel>
    </div>
  );
}
