import type { ReactNode } from "react";
import { cn } from "../../lib/utils.js";

export interface PanelProps {
  title?: ReactNode;
  description?: ReactNode;
  /** 标题行右侧动作区 */
  actions?: ReactNode;
  /** 底部动作条 */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, description, actions, footer, children, className }: PanelProps) {
  const hasHeader = title !== undefined || description !== undefined || actions !== undefined;
  return (
    <section className={cn("bg-surface border border-border rounded-lg shadow-xs", className)}>
      {hasHeader ? (
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line-soft">
          <div>
            {title === undefined ? null : <h2 className="m-0 text-lg font-bold text-foreground">{title}</h2>}
            {description === undefined ? null : (
              <p className="mt-1 mb-0 text-sm text-muted">{description}</p>
            )}
          </div>
          {actions === undefined ? null : <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
        </div>
      ) : null}
      <div className="p-5">{children}</div>
      {footer === undefined ? null : (
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-line-soft bg-surface-2">
          {footer}
        </div>
      )}
    </section>
  );
}

export interface CardProps {
  children: ReactNode;
  className?: string | undefined;
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={cn("p-4 bg-surface border border-border rounded-lg shadow-xs", className)}>
      {children}
    </div>
  );
}
