import { useEffect, useState } from "react";
import { Button } from "../ui/Button.js";
import { CopyActionButton } from "./CopyBlock.js";
import styles from "./onboarding.module.css";

export interface EnrollTokenPanelProps {
  token: string | null;
  expiresAt: number | null;
  pending: boolean;
  error: string | null;
  onIssue: () => void;
}

/** 距过期剩余毫秒；没有令牌时为 null */
function useRemaining(expiresAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (expiresAt === null) {
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (expiresAt === null) {
    return null;
  }
  return Math.max(0, expiresAt - now);
}

function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * 一次性 enroll token 面板：签发 → 一次性展示 → 倒计时。
 * 令牌与安装命令分开展示，令牌本身不参与任何命令行拼装（04 §8）。
 */
export function EnrollTokenPanel({
  token,
  expiresAt,
  pending,
  error,
  onIssue,
}: EnrollTokenPanelProps) {
  const remaining = useRemaining(expiresAt);
  const expired = token !== null && remaining !== null && remaining <= 0;

  return (
    <div className={styles.tokenPanel}>
      <div className={styles.commandHead}>
        <span className={styles.commandLabel}>enroll token（一次性，有效期 15 分钟）</span>
        <Button
          variant="primary"
          loading={pending}
          onClick={() => {
            onIssue();
          }}
        >
          {token === null ? "签发 enroll token" : "重新签发"}
        </Button>
      </div>

      {token === null ? (
        <p className={styles.hintBlock}>
          令牌由控制台签发、只在目标机安装时输入一次。它只在本页显示一次，关闭页面后不再回显。
        </p>
      ) : expired ? (
        <p className={styles.countdownExpired} role="status">
          已过期，请重新签发。
        </p>
      ) : (
        <>
          <pre className={styles.tokenValue}>{token}</pre>
          <div className={styles.countdown}>
            <span>剩余有效期</span>
            <span className={styles.countdownValue}>{formatCountdown(remaining ?? 0)}</span>
            <CopyActionButton value={token} label="复制令牌" copiedText="令牌已复制" />
          </div>
        </>
      )}

      {error === null ? null : (
        <p className={styles.countdownExpired} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
