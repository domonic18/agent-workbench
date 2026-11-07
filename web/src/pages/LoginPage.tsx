import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { LogIn, ShieldCheck } from "lucide-react";
import { login } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { bootstrapStatus } from "../api/bootstrap.js";
import { LogoIcon } from "../components/brand/LogoIcon.js";
import { Button } from "../components/ui/Button.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { Field, Input } from "../components/ui/Field.js";
import { APP_NAME, APP_NAME_EN, APP_VERSION } from "../shared/app.js";
import styles from "./LoginPage.module.css";

/** 只接受站内路径,避免 next 参数被用作开放重定向 */
function safeNext(value: string | null): string {
  if (value === null || !value.startsWith("/") || value.startsWith("//")) {
    return "/overview";
  }
  return value;
}

const CAPABILITIES = [
  {
    title: "看清状态",
    detail: "谁在跑、跑到哪一步、卡在哪里，一屏看完，不用去群里追问。",
  },
  {
    title: "管住权力",
    detail: "授权判定留在控制面，越权动作直接被拦下并留痕。",
  },
  {
    title: "算清成本",
    detail: "每次运行、每个 Token 都进账，月底不再靠猜。",
  },
];

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNeedsSetup(false);
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
      <section className={styles.brand} aria-label="产品介绍">
        <div className={styles.brandHead}>
          <span className={styles.brandMark} aria-hidden="true">
            <LogoIcon size={32} />
          </span>
          <span>
            <span className={styles.brandTitle}>{APP_NAME}</span>
            <span className={styles.brandSub}>{APP_NAME_EN}</span>
          </span>
        </div>
        <div className={styles.brandBody}>
          <h1 className={styles.brandHeadline}>
            把散落在群聊与脚本里的多 Agent 协作，收进一个可看、可控、可计量的工作台
          </h1>
          <ul className={styles.capabilities}>
            {CAPABILITIES.map((item) => (
              <li key={item.title} className={styles.capability}>
                <ShieldCheck size={16} strokeWidth={1.8} aria-hidden="true" />
                <span>
                  <span className={styles.capabilityTitle}>{item.title}</span>
                  <span className={styles.capabilityDetail}>{item.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <span className={styles.brandVersion}>{APP_VERSION}</span>
      </section>

      <section className={styles.formSide}>
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
                description="首次使用要先在 /setup 设置管理员口令并完成初始化，再回来登录。"
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
        </form>
      </section>
    </div>
  );
}
