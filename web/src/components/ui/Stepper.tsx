import { Check } from "lucide-react";
import styles from "./surfaces.module.css";

export interface StepperStep {
  key: string;
  label: string;
}

export interface StepperProps {
  steps: StepperStep[];
  /** 当前步骤下标，从 0 起 */
  current: number;
}

export function Stepper({ steps, current }: StepperProps) {
  return (
    <ol className={styles.stepper}>
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const className = [
          styles.step,
          active ? styles.stepActive : "",
          done ? styles.stepDone : "",
        ]
          .filter((item) => item !== "")
          .join(" ");
        return (
          <li key={step.key} className={className} aria-current={active ? "step" : undefined}>
            <span className={styles.stepMarker}>
              {done ? <Check size={13} aria-hidden="true" /> : index + 1}
            </span>
            <span className={styles.stepLabel}>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
