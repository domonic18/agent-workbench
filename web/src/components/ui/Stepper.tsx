import { Check } from "lucide-react";
import { cn } from "../../lib/utils.js";

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
    <ol className="flex gap-2 m-0 p-0 list-none">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={step.key}
            className={cn(
              "flex-1 flex flex-col gap-1 min-w-0",
              active && "[&_.step-marker]:bg-accent [&_.step-marker]:text-on-accent [&_.step-label]:text-foreground [&_.step-label]:font-semibold",
              done && "[&_.step-marker]:bg-positive-soft [&_.step-marker]:border [&_.step-marker]:border-positive-border [&_.step-marker]:text-positive [&_.step-label]:text-text-secondary",
            )}
            aria-current={active ? "step" : undefined}
          >
            <span className="step-marker flex items-center justify-center w-icon-tile h-icon-tile rounded-full bg-surface-3 text-muted text-xs font-bold">
              {done ? <Check size={13} aria-hidden="true" /> : index + 1}
            </span>
            <span className="step-label text-sm text-muted">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
