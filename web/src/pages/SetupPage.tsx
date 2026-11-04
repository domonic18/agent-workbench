import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/client.js";
import { bootstrapStatus } from "../api/bootstrap.js";
import {
  StepAdmin,
  StepBugfix,
  StepDone,
  StepMachine,
  StepProjects,
} from "../components/setup/SetupSteps.js";
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
    return <div className={styles.page}><div className={styles.card}>读取初始化状态…</div></div>;
  }
  if (error !== null && !unauthorized) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.error}>初始化状态读取失败:{(error as ApiError).message}</p>
        </div>
      </div>
    );
  }

  const status = statusQuery.data;
  if (status === undefined) {
    // 无凭据:bootstrap mode,先走第 1 步设置管理员
    return (
      <div className={styles.page}>
        <StepAdmin step={1} />
      </div>
    );
  }

  const step = stepForPhase(status.phase);
  if (step === 5) {
    return (
      <div className={styles.page}>
        <StepDone status={status} />
      </div>
    );
  }
  if (step === 1) {
    return (
      <div className={styles.page}>
        <StepAdmin step={1} />
      </div>
    );
  }
  if (step === 2) {
    return (
      <div className={styles.page}>
        <StepMachine step={2} status={status} />
      </div>
    );
  }
  if (step === 3) {
    return (
      <div className={styles.page}>
        <StepProjects step={3} />
      </div>
    );
  }
  return (
    <div className={styles.page}>
      <StepBugfix
        step={4}
        status={status}
        onComplete={() => void queryClient.invalidateQueries({ queryKey: ["bootstrap", "status"] })}
      />
    </div>
  );
}
