import { Panel } from "../ui/Panel.js";
import { CopyBlock } from "../ui/CopyBlock.js";
import { EnrollTokenPanel } from "./EnrollTokenPanel.js";
import type { EnrollTokenState } from "./useEnrollToken.js";
import styles from "./onboarding.module.css";

export interface InstallStepProps {
  origin: string;
  enroll: EnrollTokenState;
}

/**
 * 第 2 步：装起来 —— 跑命令、隐藏粘贴令牌、写入 launchd、自检。
 * 令牌面板就放在「粘贴令牌」这一步旁边，不用跳步也不会忘记签发。
 */
export function InstallStep({ origin, enroll }: InstallStepProps) {
  const installCommand = `curl -fsSL ${origin}/artifacts/install.sh | sh -s -- --url ${origin}`;
  const upgradeCommand = `curl -fsSL ${origin}/artifacts/install.sh | sh -s -- --url ${origin} --mode upgrade`;
  const manualCommand = `aw-node enroll --url ${origin}`;

  return (
    <div className={styles.stack}>
      <Panel title="按这四步装完" description="脚本会带你走完大部分流程，你只需要确认提示与粘贴令牌。">
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepMarker} aria-hidden="true">
              1
            </span>
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>在目标机执行安装命令</p>
              <p className={styles.stepDesc}>脚本自动识别 CPU 架构、下载产物并比对 SHA-256，校验不过就中止，不会装半个。</p>
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
              <p className={styles.stepDesc}>输入不回显，也不进命令行参数与 shell history。令牌过期就回到上面重新签发一枚。</p>
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
              <p className={styles.stepDesc}>机器身份与凭据落在 ~/.aw-node（仅当前用户可读），plist 写入 ~/Library/LaunchAgents，崩溃后自动重启。</p>
            </div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepMarker} aria-hidden="true">
              4
            </span>
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>自检</p>
              <p className={styles.stepDesc}>安装脚本末尾会跑一次 aw-node doctor；也可以随时用 aw-node status 查看当前状态。</p>
            </div>
          </li>
        </ol>
      </Panel>

      <Panel
        title="覆盖安装（已加入过的机器）"
        description="这台机已经 enroll 过就直接用这条：不需要一次性 token，不换机器身份，Agent 绑定不动，既有的 launchd 环境变量也原样保留。"
      >
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepMarker} aria-hidden="true">
              1
            </span>
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>在目标机执行覆盖安装命令</p>
              <p className={styles.stepDesc}>
                脚本复用本机已落盘的机器凭据重装服务，会先摘干净旧服务再装载，等价于升级。
                换版本、修复安装、重新绑定项目都用它。
              </p>
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

      <Panel title="手动安装（备选）" description="装不上脚本、或要纳管已有二进制时走这条。">
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepMarker} aria-hidden="true">
              1
            </span>
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>下载对应平台的产物到本地</p>
              <p className={styles.stepDesc}>从上一步的平台卡片下载，或从 GitHub Release 取同名文件。</p>
            </div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepMarker} aria-hidden="true">
              2
            </span>
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>加执行权限</p>
              <p className={styles.stepDesc}>
                <code>chmod +x aw-node-macos-arm64</code>（或 x64，按下载的平台选）。
              </p>
            </div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepMarker} aria-hidden="true">
              3
            </span>
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>enroll 换机器身份</p>
              <p className={styles.stepDesc}>按提示粘贴同一枚一次性令牌，输入不回显。</p>
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
