import { Loader2 } from "lucide-react";

export interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label = "加载中…" }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 min-h-[400px] text-sm text-muted" role="status">
      <Loader2 size={22} strokeWidth={1.8} className="inline-flex text-accent animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
