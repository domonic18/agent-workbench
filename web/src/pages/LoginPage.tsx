import { type FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { login } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { bootstrapStatus } from "../api/bootstrap.js";
import styles from "./LoginPage.module.css";

/** 只接受站内路径,避免 next 参数被用作开放重定向 */
function safeNext(value: string | null): string {
  if (value === null || !value.startsWith("/") || value.startsWith("//")) {
    return "/overview";
  }
  return value;
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(password);
      // 初始化未完成则进入 /setup 引导,否则按 next 回目标页
      let target = safeNext(params.get("next"));
      try {
        const status = await bootstrapStatus();
        if (status.phase !== "ready") {
          target = "/setup";
        }
      } catch {
        // 状态读取失败不阻断登录,沿用 next
      }
      navigate(target, { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "登录失败,请稍后再试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={(event) => void handleSubmit(event)}>
        <h1 className={styles.title}>Agent 工作台</h1>
        <p className={styles.description}>输入控制台口令以继续</p>
        <label className={styles.label} htmlFor="password">
          控制台口令
        </label>
        <input
          id="password"
          className={styles.input}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <button className={styles.submit} type="submit" disabled={pending}>
          {pending ? "登录中…" : "登录"}
        </button>
      </form>
    </div>
  );
}
