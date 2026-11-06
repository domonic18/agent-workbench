import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { copyToClipboard } from "../../shared/clipboard.js";
import { Button } from "../ui/Button.js";
import { useToast } from "../ui/Toast.js";
import styles from "./onboarding.module.css";

export interface CopyActionButtonProps {
  value: string;
  label: string;
  /** 复制成功提示文案 */
  copiedText?: string;
  size?: "sm" | "md";
}

/** 行内复制按钮：复制成功走 toast 反馈，失败也要说清楚 */
export function CopyActionButton({
  value,
  label,
  copiedText = "已复制",
  size = "sm",
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

/** 大号命令块：等宽展示 + 一键复制（toast 反馈），供安装命令与令牌用 */
export function CopyBlock({
  label,
  value,
  copyLabel = "复制",
  copiedText = "已复制到剪贴板",
  note,
}: CopyBlockProps) {
  return (
    <div className={styles.commandBlock}>
      <div className={styles.commandHead}>
        <span className={styles.commandLabel}>{label}</span>
        <CopyActionButton value={value} label={copyLabel} copiedText={copiedText} />
      </div>
      <pre className={styles.commandValue}>{value}</pre>
      {note === undefined ? null : <p className={styles.hintBlock}>{note}</p>}
    </div>
  );
}
