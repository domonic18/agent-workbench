import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { DownloadStep } from "../components/onboarding/DownloadStep.js";
import { EnrollTokenPanel } from "../components/onboarding/EnrollTokenPanel.js";
import { InstallStep } from "../components/onboarding/InstallStep.js";
import { OnlineMachines } from "../components/onboarding/OnlineMachines.js";
import { useEnrollToken } from "../components/onboarding/useEnrollToken.js";
import { Button } from "../components/ui/Button.js";
import { Panel } from "../components/ui/Panel.js";
import { Stepper, type StepperStep } from "../components/ui/Stepper.js";

const STEPS: StepperStep[] = [
  { key: "download", label: "下载产物" },
  { key: "install", label: "安装执行机" },
  { key: "online", label: "令牌与上线" },
];

/** 接入执行机：下载 → 安装 → 令牌与上线，三步走完机器就在线了 */
export function OnboardingPage() {
  const [step, setStep] = useState(0);
  const enroll = useEnrollToken();
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="flex flex-col gap-5">
      <Stepper steps={STEPS} current={step} />

      {step === 0 ? <DownloadStep origin={origin} /> : null}

      {step === 1 ? <InstallStep origin={origin} enroll={enroll} /> : null}

      {step === 2 ? (
        <>
          <Panel title="签发令牌并确认上线">
            <EnrollTokenPanel
              token={enroll.token}
              expiresAt={enroll.expiresAt}
              pending={enroll.pending}
              error={enroll.error}
              onIssue={() => {
                void enroll.issue();
              }}
            />
          </Panel>
          <OnlineMachines />
        </>
      ) : null}

      <nav className="flex justify-between gap-3 max-md:flex-col-reverse" aria-label="步骤切换">
        <div className="flex gap-2 max-md:flex-col-reverse max-md:[&_button]:w-full">
          <Button
            variant="ghost"
            icon={<ArrowLeft size={15} aria-hidden="true" />}
            disabled={step === 0}
            onClick={() => setStep((current) => Math.max(0, current - 1))}
          >
            上一步
          </Button>
        </div>
        <div className="flex gap-2 max-md:flex-col-reverse max-md:[&_button]:w-full">
          {step < STEPS.length - 1 ? (
            <Button
              variant="primary"
              icon={<ArrowRight size={15} aria-hidden="true" />}
              onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}
            >
              下一步
            </Button>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
