import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { copyToClipboard } from "../../shared/clipboard.js";
import { Button } from "./Button.js";
import styles from "./controls.module.css";

export interface CopyFieldProps {
  label?: ReactNode;
  value: string;
  hint?: ReactNode;
  /** 复制成功提示文案 */
  copiedText?: string;
}

/** 值 + 一键复制 + 复制反馈，接管散落的复制按钮 */
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
      {label === undefined ? null : <div className={styles.hint}>{label}</div>}
      <div className={styles.copyField}>
        <span className={styles.copyValue}>{value}</span>
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
      {hint === undefined ? null : <div className={styles.hint}>{hint}</div>}
    </div>
  );
}
