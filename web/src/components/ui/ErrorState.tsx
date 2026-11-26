import { AlertTriangle } from "lucide-react";
import { Button } from "./Button.js";

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ title = "加载失败", message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 min-h-[240px] p-6 border border-danger-border rounded-lg bg-danger-soft text-center" role="alert">
      <AlertTriangle size={20} strokeWidth={1.8} className="inline-flex text-danger" aria-hidden="true" />
      <span className="text-md font-semibold text-foreground">{title}</span>
      <span className="max-w-[40em] text-sm text-text-secondary">{message}</span>
      {onRetry === undefined ? null : (
        <div className="mt-2">
          <Button size="sm" variant="secondary" onClick={onRetry}>
            重试
          </Button>
        </div>
      )}
    </div>
  );
}
