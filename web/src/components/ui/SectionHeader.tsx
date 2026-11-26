import type { ReactNode } from "react";

export interface SectionHeaderProps {
  title: ReactNode;
  /** 标题旁的一句说明 */
  hint?: ReactNode;
  /** 右侧操作区 */
  actions?: ReactNode;
}

export function SectionHeader({ title, hint, actions }: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="m-0 text-lg font-semibold text-foreground">{title}</h2>
        {hint === undefined ? null : <span className="text-sm text-muted">{hint}</span>}
      </div>
      {actions === undefined ? null : <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
