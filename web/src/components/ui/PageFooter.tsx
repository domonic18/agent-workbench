import type { ReactNode } from "react";

export interface PageFooterProps {
  children: ReactNode;
}

export function PageFooter({ children }: PageFooterProps) {
  return <p className="m-0 pt-4 border-t border-border text-xs text-muted">{children}</p>;
}
