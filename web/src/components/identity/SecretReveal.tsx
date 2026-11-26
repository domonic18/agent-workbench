import { useState } from "react";
import { Button } from "../ui/Button.js";

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
    <div className="flex flex-col gap-3">
      <p className="m-0 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning" role="alert">
        关闭后不可再查看，请立即保存到安全位置。
      </p>
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs break-all max-md:min-h-touch">{secret}</code>
        <Button variant="secondary" onClick={() => void copy()}>
          {copied === "copied" ? "已复制" : "复制"}
        </Button>
      </div>
      {copied === "failed" ? (
        <p className="m-0 text-xs text-muted">复制失败，请手动选中密钥。</p>
      ) : null}
      {note === undefined ? null : <p className="m-0 text-xs text-muted">{note}</p>}
      {hints.length === 0 ? null : (
        <ul className="m-0 pl-5 text-xs text-muted">
          {hints.map((hint) => (
            <li key={hint} className="mt-1">{hint}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
