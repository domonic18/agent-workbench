import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { copyToClipboard } from "../../shared/clipboard.js";
import { Button } from "./Button.js";
import { useToast } from "./Toast.js";

export interface CopyActionButtonProps {
  value: string;
  label: string;
  /** 复制成功提示文案 */
  copiedText?: string;
  size?: "sm" | "md";
  /** 内容还没到手时禁用，避免复制到空串 */
  disabled?: boolean;
}

export function CopyActionButton({
  value,
  label,
  copiedText = "已复制",
  size = "sm",
  disabled = false,
}: CopyActionButtonProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    const ok = await copyToClipboard(value);
    if (!ok) {
      toast.push("复制失败，请手动选中复制", "danger");
      return;
    }
    setCopied(true);
    toast.push(copiedText, "positive");
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Button
      size={size}
      variant="secondary"
      disabled={disabled}
      icon={copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      onClick={() => void handleCopy()}
    >
      {copied ? "已复制" : label}
    </Button>
  );
}

export interface CopyBlockProps {
  label: string;
  value: string;
  /** 复制按钮文案 */
  copyLabel?: string;
  copiedText?: string;
  /** 补充说明，排在命令块下面 */
  note?: string;
}

export function CopyBlock({
  label,
  value,
  copyLabel = "复制",
  copiedText = "已复制到剪贴板",
  note,
}: CopyBlockProps) {
  return (
    <div className="flex flex-col gap-2 p-4 border rounded-lg bg-surface-2">
      <div className="flex items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
        <span className="text-sm font-semibold text-text-secondary">{label}</span>
        <CopyActionButton value={value} label={copyLabel} copiedText={copiedText} />
      </div>
      <pre className="m-0 p-3 border rounded-md bg-surface font-mono text-sm leading-relaxed text-foreground overflow-x-auto whitespace-pre-wrap break-words">
        {value}
      </pre>
      {note === undefined ? null : <p className="m-0 text-sm text-muted">{note}</p>}
    </div>
  );
}
