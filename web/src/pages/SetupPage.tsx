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
import { APP_NAME, APP_VERSION } from "../shared/app.js";
import styles from "../components/setup/setup.module.css";

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
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.shellHead}>
          <span className={styles.shellMark} aria-hidden="true">
            AW
          </span>
          <span className={styles.shellTitle}>{APP_NAME}</span>
          <span className={styles.shellVersion}>{APP_VERSION}</span>
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
    return <Shell><div className={styles.card}>读取初始化状态…</div></Shell>;
  }
  if (error !== null && !unauthorized) {
    return (
      <Shell>
        <div className={styles.card}>
          <p className={styles.error}>初始化状态读取失败:{(error as ApiError).message}</p>
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
