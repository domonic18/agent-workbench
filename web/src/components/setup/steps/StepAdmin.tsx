import { type FormEvent, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../../api/client.js";
import { bootstrapAdmin } from "../../../api/bootstrap.js";
import { StepHeader } from "../StepHeader.js";
import { Feedback } from "../Feedback.js";
import styles from "../setup.module.css";

export function StepAdmin({ step }: { step: number }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await bootstrapAdmin(token.trim(), password);
      await queryClient.invalidateQueries({ queryKey: ["bootstrap", "status"] });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "初始化失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.card}>
      <StepHeader step={step} />
      <h1 className={styles.title}>初始化控制台</h1>
      <p className={styles.description}>
        输入本机启动输出的 bootstrap token 并设置管理员口令,即解锁完整控制台。空库与空知识将自动建好。
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <label className={styles.label} htmlFor="token">bootstrap token</label>
        <input
          id="token"
          className={styles.input}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="从控制台启动日志复制"
          autoComplete="off"
        />
        <label className={styles.label} htmlFor="password">管理员口令</label>
        <input
          id="password"
          className={styles.input}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
        />
        <button className={styles.button} type="submit" disabled={pending || token.trim() === "" || password === ""}>
          {pending ? "初始化中…" : "设置口令并继续"}
        </button>
        <Feedback error={error} />
      </form>
    </div>
  );
}
