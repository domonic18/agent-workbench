import { useEffect, useState } from "react";

/** 仅用于「已等待」这类展示时钟,不参与数据轮询(03 §5) */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
