import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** 引导动作，如「接入执行机」 */
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="px-4 py-7 border border-dashed border-border rounded-lg bg-surface-2 text-center">
      {icon === undefined ? null : (
        <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 rounded-full bg-accent-soft text-accent" aria-hidden="true">
          {icon}
        </div>
      )}
      <div className="text-lg font-semibold text-foreground">{title}</div>
      {description === undefined ? null : (
        <div className="mt-2 text-sm text-muted">{description}</div>
      )}
      {action === undefined ? null : <div className="mt-4">{action}</div>}
    </div>
  );
}
