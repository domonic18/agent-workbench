import { LogIn, ShieldCheck, Sparkles } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { feishuLogin, feishuStatus, login } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { bootstrapStatus } from "../api/bootstrap.js";
import { requestFeishuAuthCode } from "../components/auth/feishu-jsapi.js";
import { Button } from "../components/ui/Button.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { Field, Input } from "../components/ui/Field.js";

function safeNext(value: string | null): string {
  if (value === null || !value.startsWith("/") || value.startsWith("//")) {
    return "/overview";
  }
  return value;
}

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
      if (caught instanceof ApiError && caught.code === "BOOTSTRAP_REQUIRED") {
        setNeedsSetup(true);
      }
      setError(caught instanceof ApiError ? caught.message : "登录失败,请稍后再试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-5 bg-background max-md:p-4">
      <section className="w-full max-w-dialog-sm">
        {feishuPhase === "auto" ? (
          <div className="w-full flex flex-col gap-4 p-6 border border-border rounded-lg bg-surface shadow-md max-md:p-5" aria-live="polite">
            <h2 className="m-0 text-xl font-semibold">登录控制台</h2>
            <p className="flex items-center justify-center gap-2 min-h-touch text-sm text-muted">
              <Sparkles size={16} aria-hidden="true" />
              飞书免登中…
            </p>
          </div>
        ) : (
          <form
            className="w-full flex flex-col gap-4 p-6 border border-border rounded-lg bg-surface shadow-md max-md:p-5"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <h2 className="m-0 text-xl font-semibold">登录控制台</h2>
            <p className="-mt-2 mb-0 text-sm text-muted">输入管理员口令以继续</p>
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
                    <Link className="text-sm" to="/setup">
                      前往 /setup 完成初始化 →
                    </Link>
                  }
                />
              </div>
            ) : error === null ? null : (
              <p className="m-0 text-sm text-danger" role="alert">
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
                <span className="flex items-center gap-3 -my-1 text-muted text-xs before:content-[''] before:flex-1 before:border-t before:border-border after:content-[''] after:flex-1 after:border-t after:border-border">
                  或
                </span>
                {feishuNotice === null ? null : (
                  <p className="m-0 text-sm text-muted">{feishuNotice}</p>
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
