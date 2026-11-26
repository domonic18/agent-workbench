import type { ReactNode } from "react";

export interface StatCardProps {
  /** 微标签：短、大写、弱化 */
  label: string;
  value: ReactNode;
  /** 数值下方的补充说明 */
  sub?: ReactNode;
  icon?: ReactNode;
  /** 悬停提示（精确值等） */
  title?: string;
}

export function StatCard({ label, value, sub, icon, title }: StatCardProps) {
  return (
    <div className="p-4 border border-border rounded-md bg-surface transition-colors hover:border-border-hover" title={title}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-tight uppercase text-text-secondary">{label}</span>
        {icon === undefined ? null : (
          <span className="inline-flex items-center justify-center w-icon-tile h-icon-tile rounded-sm bg-accent-soft text-accent" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-foreground">{value}</div>
      {sub === undefined ? null : <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}
