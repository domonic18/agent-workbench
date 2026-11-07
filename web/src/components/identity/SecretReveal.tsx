import { useState } from "react";
import { Button } from "../ui/Button.js";
import styles from "./IdentityForm.module.css";

export interface SecretRevealProps {
  secret: string;
  note?: string;
  hints?: readonly string[];
}

export function SecretReveal({ secret, note, hints = [] }: SecretRevealProps) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className={styles.secret}>
      <p className={styles.warning} role="alert">
        关闭后不可再查看，请立即保存到安全位置。
      </p>
      <div className={styles.secretRow}>
        <code className={styles.secretCode}>{secret}</code>
        <Button variant="secondary" onClick={() => void copy()}>
          {copied === "copied" ? "已复制" : "复制"}
        </Button>
      </div>
      {copied === "failed" ? (
        <p className={styles.hint}>复制失败，请手动选中密钥。</p>
      ) : null}
      {note === undefined ? null : <p className={styles.hint}>{note}</p>}
      {hints.length === 0 ? null : (
        <ul className={styles.hints}>
          {hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
