import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { ApiError } from "../api/client.js";
import { bootstrapStatus } from "../api/bootstrap.js";
import {
  StepAdmin,
  StepBugfix,
  StepDone,
  StepMachine,
  StepProjects,
} from "../components/setup/SetupSteps.js";
import { SetupStepper } from "../components/setup/SetupStepper.js";
import { LogoIcon } from "../components/brand/LogoIcon.js";
import { APP_NAME, APP_VERSION } from "../shared/app.js";

function stepForPhase(phase: string): number {
  switch (phase) {
    case "awaiting_machine": return 2;
    case "awaiting_agents": return 3;
    case "awaiting_completion": return 4;
    case "ready": return 5;
    default: return 1;
  }
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-start justify-center pt-6 px-4 pb-7 bg-background text-foreground">
      <div className="w-full max-w-dialog-lg flex flex-col gap-5">
        <header className="flex items-center gap-3">
          <span className="grid place-items-center h-control-lg w-control-lg rounded-md bg-accent text-on-accent" aria-hidden="true">
            <LogoIcon size={28} />
          </span>
          <span className="text-lg font-semibold">{APP_NAME}</span>
          <span className="ml-auto text-xs text-muted">{APP_VERSION}</span>
        </header>
        {children}
      </div>
    </div>
  );
}

export function SetupPage() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ["bootstrap", "status"],
    queryFn: bootstrapStatus,
    retry: false,
    refetchInterval: 5000,
  });

  const error = statusQuery.error;
  const unauthorized = error instanceof ApiError && error.status === 401;
  if (statusQuery.isLoading && !unauthorized) {
    return <Shell><div className="w-full bg-surface border border-border rounded-lg p-6 shadow-sm max-md:[&_input]:min-h-touch max-md:[&_select]:min-h-touch max-md:[&_button]:min-h-touch">读取初始化状态…</div></Shell>;
  }
  if (error !== null && !unauthorized) {
    return (
      <Shell>
        <div className="w-full bg-surface border border-border rounded-lg p-6 shadow-sm max-md:[&_input]:min-h-touch max-md:[&_select]:min-h-touch max-md:[&_button]:min-h-touch">
          <p className="text-danger text-sm mt-3">初始化状态读取失败:{(error as ApiError).message}</p>
        </div>
      </Shell>
    );
  }

  const status = statusQuery.data;
  if (status === undefined) {
    // 无凭据:bootstrap mode,先走第 1 步设置管理员
    return (
      <Shell>
        <SetupStepper step={1} />
        <StepAdmin />
      </Shell>
    );
  }

  const step = stepForPhase(status.phase);
  if (step === 5) {
    return (
      <Shell>
        <SetupStepper completed />
        <StepDone status={status} />
      </Shell>
    );
  }
  if (step === 1) {
    return (
      <Shell>
        <SetupStepper step={1} />
        <StepAdmin />
      </Shell>
    );
  }
  if (step === 2) {
    return (
      <Shell>
        <SetupStepper step={2} />
        <StepMachine status={status} />
      </Shell>
    );
  }
  if (step === 3) {
    return (
      <Shell>
        <SetupStepper step={3} />
        <StepProjects />
      </Shell>
    );
  }
  return (
    <Shell>
      <SetupStepper step={4} />
      <StepBugfix
        status={status}
        onComplete={() => void queryClient.invalidateQueries({ queryKey: ["bootstrap", "status"] })}
      />
    </Shell>
  );
}
