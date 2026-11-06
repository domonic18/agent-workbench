import { useCallback, useState } from "react";
import { ApiError } from "../../api/client.js";
import { issueEnrollToken } from "../../api/bootstrap.js";

export interface EnrollTokenState {
  token: string | null;
  expiresAt: number | null;
  pending: boolean;
  error: string | null;
  issue: () => Promise<void>;
  clear: () => void;
}

/**
 * 一次性 enroll token 的本地状态：只留当前这一枚，签发新令牌即丢弃旧的。
 * 令牌不落盘、不进 URL、不回显历史值（04 §8）。
 */
export function useEnrollToken(): EnrollTokenState {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issue = useCallback(async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      const issued = await issueEnrollToken();
      setToken(issued.token);
      setExpiresAt(issued.expiresAt);
    } catch (caught) {
      setToken(null);
      setExpiresAt(null);
      setError(caught instanceof ApiError ? caught.message : "签发失败，请重试");
    } finally {
      setPending(false);
    }
  }, []);

  const clear = useCallback((): void => {
    setToken(null);
    setExpiresAt(null);
    setError(null);
  }, []);

  return { token, expiresAt, pending, error, issue, clear };
}
