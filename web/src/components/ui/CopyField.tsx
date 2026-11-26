import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { copyToClipboard } from "../../shared/clipboard.js";
import { Button } from "./Button.js";

export interface CopyFieldProps {
  label?: ReactNode;
  value: string;
  hint?: ReactNode;
  /** 复制成功提示文案 */
  copiedText?: string;
}

export function CopyField({ label, value, hint, copiedText = "已复制" }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    const ok = await copyToClipboard(value);
    if (!ok) {
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div>
      {label === undefined ? null : <div className="text-xs text-muted">{label}</div>}
      <div className="flex items-center gap-2 py-2 pr-2 pl-3 border rounded-md bg-surface-2">
        <span className="flex-1 min-w-0 font-mono text-sm break-words">{value}</span>
        <Button
          size="sm"
          variant="secondary"
          icon={
            copied ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <Copy size={14} aria-hidden="true" />
            )
          }
          aria-live="polite"
          onClick={() => void handleCopy()}
        >
          {copied ? copiedText : "复制"}
        </Button>
      </div>
      {hint === undefined ? null : <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}
