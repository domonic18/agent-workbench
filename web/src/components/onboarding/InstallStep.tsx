import { Panel } from "../ui/Panel.js";
import { CopyBlock } from "../ui/CopyBlock.js";
import { EnrollTokenPanel } from "./EnrollTokenPanel.js";
import type { EnrollTokenState } from "./useEnrollToken.js";

export interface InstallStepProps {
  origin: string;
  enroll: EnrollTokenState;
}

export function InstallStep({ origin, enroll }: InstallStepProps) {
  const installCommand = `curl -fsSL ${origin}/artifacts/install.sh | sh -s -- --url ${origin}`;
  const upgradeCommand = `curl -fsSL ${origin}/artifacts/install.sh | sh -s -- --url ${origin} --mode upgrade`;
  const manualCommand = `aw-node enroll --url ${origin}`;

  return (
    <div className="flex flex-col gap-5">
      <Panel title="按这四步装完">
        <ol className="flex flex-col gap-4 m-0 p-0 list-none">
          <li className="flex gap-3">
            <span className="shrink-0 grid place-items-center w-icon-tile h-icon-tile rounded-full bg-accent-soft text-accent text-xs font-bold" aria-hidden="true">
              1
            </span>
            <div className="flex flex-col gap-2 min-w-0">
              <p className="m-0 text-md font-semibold text-foreground">在目标机执行安装命令</p>
              <CopyBlock
                label="在目标机执行"
                value={installCommand}
                copyLabel="复制命令"
                copiedText="安装命令已复制"
              />
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 grid place-items-center w-icon-tile h-icon-tile rounded-full bg-accent-soft text-accent text-xs font-bold" aria-hidden="true">
              2
            </span>
            <div className="flex flex-col gap-2 min-w-0">
              <p className="m-0 text-md font-semibold text-foreground">脚本提示时粘贴一次性 enroll token</p>
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
          <li className="flex gap-3">
            <span className="shrink-0 grid place-items-center w-icon-tile h-icon-tile rounded-full bg-accent-soft text-accent text-xs font-bold" aria-hidden="true">
              3
            </span>
            <div className="flex flex-col gap-2 min-w-0">
              <p className="m-0 text-md font-semibold text-foreground">enroll 成功后写入 launchd 并拉起服务</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 grid place-items-center w-icon-tile h-icon-tile rounded-full bg-accent-soft text-accent text-xs font-bold" aria-hidden="true">
              4
            </span>
            <div className="flex flex-col gap-2 min-w-0">
              <p className="m-0 text-md font-semibold text-foreground">自检</p>
            </div>
          </li>
        </ol>
      </Panel>

      <Panel title="覆盖安装（已加入过的机器）">
        <ol className="flex flex-col gap-4 m-0 p-0 list-none">
          <li className="flex gap-3">
            <span className="shrink-0 grid place-items-center w-icon-tile h-icon-tile rounded-full bg-accent-soft text-accent text-xs font-bold" aria-hidden="true">
              1
            </span>
            <div className="flex flex-col gap-2 min-w-0">
              <p className="m-0 text-md font-semibold text-foreground">在目标机执行覆盖安装命令</p>
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
        <ol className="flex flex-col gap-4 m-0 p-0 list-none">
          <li className="flex gap-3">
            <span className="shrink-0 grid place-items-center w-icon-tile h-icon-tile rounded-full bg-accent-soft text-accent text-xs font-bold" aria-hidden="true">
              1
            </span>
            <div className="flex flex-col gap-2 min-w-0">
              <p className="m-0 text-md font-semibold text-foreground">下载对应平台的产物到本地</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 grid place-items-center w-icon-tile h-icon-tile rounded-full bg-accent-soft text-accent text-xs font-bold" aria-hidden="true">
              2
            </span>
            <div className="flex flex-col gap-2 min-w-0">
              <p className="m-0 text-md font-semibold text-foreground">加执行权限</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 grid place-items-center w-icon-tile h-icon-tile rounded-full bg-accent-soft text-accent text-xs font-bold" aria-hidden="true">
              3
            </span>
            <div className="flex flex-col gap-2 min-w-0">
              <p className="m-0 text-md font-semibold text-foreground">enroll 换机器身份</p>
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
