import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { LogIn, ShieldCheck, Sparkles } from "lucide-react";
import { feishuLogin, feishuStatus, login } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { bootstrapStatus } from "../api/bootstrap.js";
import { requestFeishuAuthCode } from "../components/auth/feishu-jsapi.js";
import { Button } from "../components/ui/Button.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { Field, Input } from "../components/ui/Field.js";
import styles from "./LoginPage.module.css";

/** 只接受站内路径,避免 next 参数被用作开放重定向 */
function safeNext(value: string | null): string {
  if (value === null || !value.startsWith("/") || value.startsWith("//")) {
    return "/overview";
  }
  return value;
}

/** 免登阶段:探测配置中 / 自动免登中(表单隐藏) / 回落口令登录 */
type FeishuPhase = "checking" | "auto" | "password";

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [feishuPhase, setFeishuPhase] = useState<FeishuPhase>("checking");
  const [feishuEnabled, setFeishuEnabled] = useState(false);
  const [feishuNotice, setFeishuNotice] = useState<string | null>(null);
  const appIdRef = useRef("");

  /** 登录成功后的落地逻辑对口令与免登一致:初始化未完成去 /setup,否则按 next 回目标页 */
  const landAfterLogin = useCallback(
    async (fallbackTarget: string) => {
      let target = fallbackTarget;
      try {
        const status = await bootstrapStatus();
        if (status.phase !== "ready") {
          target = "/setup";
        }
      } catch {
        // 状态读取失败不阻断登录,沿用 next
      }
      navigate(target, { replace: true });
    },
    [navigate],
  );

  const attemptFeishuLogin = useCallback(async () => {
    setFeishuPhase("auto");
    setFeishuNotice(null);
    try {
      const code = await requestFeishuAuthCode(appIdRef.current);
      await feishuLogin(code);
      await landAfterLogin(safeNext(params.get("next")));
    } catch (caught) {
      // 未在白名单 / 环境不支持 / 超时都回落口令登录;给一行提示,不吞错
      setFeishuNotice(caught instanceof ApiError ? caught.message : "飞书免登未完成,可使用口令登录");
      setFeishuPhase("password");
    }
  }, [landAfterLogin, params]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let appId = "";
      try {
        const status = await feishuStatus();
        appId = status.enabled ? status.appId : "";
      } catch {
        // 状态探测失败视同免登关闭
      }
      if (cancelled) {
        return;
      }
      if (appId === "") {
        setFeishuPhase("password");
        return;
      }
      appIdRef.current = appId;
      setFeishuEnabled(true);
      await attemptFeishuLogin();
    })();
    return () => {
      cancelled = true;
    };
    // 仅进页探测一次;手动重试走表单里的按钮
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNeedsSetup(false);
    try {
      await login(password);
      await landAfterLogin(safeNext(params.get("next")));
    } catch (caught) {
      // 控制台未初始化时登录必然被拒:引导去 /setup,不给死胡同
      if (caught instanceof ApiError && caught.code === "BOOTSTRAP_REQUIRED") {
        setNeedsSetup(true);
      }
      setError(caught instanceof ApiError ? caught.message : "登录失败,请稍后再试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.formSide}>
        {feishuPhase === "auto" ? (
          <div className={styles.card} aria-live="polite">
            <h2 className={styles.title}>登录控制台</h2>
            <p className={styles.feishuPending}>
              <Sparkles size={16} aria-hidden="true" />
              飞书免登中…
            </p>
          </div>
        ) : (
          <form className={styles.card} onSubmit={(event) => void handleSubmit(event)}>
            <h2 className={styles.title}>登录控制台</h2>
            <p className={styles.description}>输入管理员口令以继续</p>
            <Field label="控制台口令" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Field>
            {needsSetup ? (
              <div role="alert">
                <EmptyState
                  icon={<ShieldCheck size={28} aria-hidden="true" />}
                  title="控制台未初始化"
                  action={
                    <Link className={styles.link} to="/setup">
                      前往 /setup 完成初始化 →
                    </Link>
                  }
                />
              </div>
            ) : error === null ? null : (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={pending}
              icon={<LogIn size={16} aria-hidden="true" />}
            >
              {pending ? "登录中…" : "登录"}
            </Button>
            {!feishuEnabled ? null : (
              <>
                <span className={styles.feishuDivider}>或</span>
                {feishuNotice === null ? null : (
                  <p className={styles.notice}>{feishuNotice}</p>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  icon={<Sparkles size={16} aria-hidden="true" />}
                  onClick={() => void attemptFeishuLogin()}
                >
                  使用飞书免登
                </Button>
              </>
            )}
          </form>
        )}
      </section>
    </div>
  );
}
