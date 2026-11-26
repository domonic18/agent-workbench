import { type BootstrapStatus } from "../../../api/bootstrap.js";
import { DownloadStep } from "../../onboarding/DownloadStep.js";
import { InstallStep } from "../../onboarding/InstallStep.js";
import { OnlineMachines } from "../../onboarding/OnlineMachines.js";
import { useEnrollToken } from "../../onboarding/useEnrollToken.js";

/** /setup 第 2 步：接入执行机。复用 /onboarding 的同一套组件，两处不各写一份。 */
export function StepMachine({ status }: { status: BootstrapStatus }) {
  const enroll = useEnrollToken();
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <>
      <div className="w-full bg-surface border border-border rounded-lg p-6 shadow-sm max-md:[&_input]:min-h-touch max-md:[&_select]:min-h-touch max-md:[&_button]:min-h-touch">
        <h1 className="m-0 mb-1 text-xl font-semibold">添加执行机</h1>
        <p className="text-muted m-0 mb-5 text-md">
          在目标机执行安装命令,按提示粘贴一次性 enroll token(输入不回显)。控制台据此换取机器 ID、安装并启动 aw-node。
        </p>
        {status.machines > 0 ? (
          <p className="text-muted text-xs mt-2">已检测到 {status.machines} 台执行机,可进入下一步。</p>
        ) : (
          <p className="text-muted text-xs mt-2">等待执行机上线并回报心跳…</p>
        )}
      </div>
      <DownloadStep origin={origin} />
      <InstallStep origin={origin} enroll={enroll} />
      <OnlineMachines />
    </>
  );
}
