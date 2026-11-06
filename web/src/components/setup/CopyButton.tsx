import { useState } from "react";
import styles from "./setup.module.css";

/** 复制按钮:剪贴板不可用时提示手动选中 */
export function CopyButton({ value, label = "复制" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <button type="button" className={styles.copyButton} onClick={() => void copy()}>
      {state === "copied" ? "已复制" : state === "failed" ? "复制失败" : label}
    </button>
  );
}
