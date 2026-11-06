import { BookOpen, LayoutGrid, ListChecks, ShieldCheck } from "lucide-react";
import { Suspense } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { logout } from "../../api/auth.js";
import { RealtimeProvider, useRealtimeStatus } from "../../api/stream.js";
import { Badge } from "../ui/Badge.js";
import { REALTIME_LABEL, REALTIME_TONE } from "../../shared/labels.js";
import { ThemeToggle } from "./ThemeToggle.js";
import styles from "./AppShell.module.css";

const NAV = [
  { to: "/overview", label: "总览", icon: LayoutGrid },
  { to: "/tasks", label: "任务", icon: ListChecks },
  { to: "/capabilities", label: "授权", icon: ShieldCheck },
  { to: "/knowledge", label: "知识", icon: BookOpen },
] as const;

const PAGE_META: { path: string; title: string; description: string }[] = [
  {
    path: "/overview",
    title: "总览",
    description: "Agent 在线状态、当前任务，以及需要你看一眼的事项",
  },
  {
    path: "/tasks",
    title: "任务",
    description: "工作台里正在流转与已收口的任务",
  },
  {
    path: "/capabilities",
    title: "授权",
    description: "能力签发与委派白名单的授权事实",
  },
  {
    path: "/knowledge",
    title: "知识",
    description: "人工采纳与待审阅的知识条目",
  },
];

function pageMeta(pathname: string): { title: string; description: string } {
  const matched = PAGE_META.find((item) => pathname.startsWith(item.path));
  return matched ?? { title: "总览", description: "" };
}

function environment(): { label: string; local: boolean } {
  const host = window.location.host;
  const local = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
  return { label: local ? `本机 ${host}` : `穿透 ${host}`, local };
}

export function AppShell() {
  return (
    <RealtimeProvider>
      <Shell />
    </RealtimeProvider>
  );
}

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const env = environment();
  const meta = pageMeta(location.pathname);
  const realtime = useRealtimeStatus();

  async function handleLogout(): Promise<void> {
    try {
      await logout();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.nav} aria-label="主导航">
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            AW
          </span>
          <span>
            <span className={styles.brandTitle}>智能体工作台</span>
            <span className={styles.brandSub}>Agent Workbench</span>
          </span>
        </div>

        <div className={styles.links}>
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ""}`}
              >
                <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                {item.label}
              </NavLink>
            );
          })}
        </div>

        <div className={styles.navFooter}>
          <span className={env.local ? styles.envLocal : styles.envTunnel}>{env.label}</span>
          <div className={styles.footerRow}>
            <span className={styles.version}>v0.1</span>
            <ThemeToggle variant="sidebar" />
          </div>
        </div>
      </nav>

      <div className={styles.body}>
        <header className={styles.topbar}>
          <div className={styles.heading}>
            <h1 className={styles.pageTitle}>{meta.title}</h1>
            <span className={styles.pageDescription}>{meta.description}</span>
          </div>
          <div className={styles.topbarRight}>
            <Badge tone={REALTIME_TONE[realtime]} text={REALTIME_LABEL[realtime]} />
            <span className={styles.user}>
              <span className={styles.avatar} aria-hidden="true">
                管
              </span>
              管理员
            </span>
            <button type="button" className={styles.logout} onClick={() => void handleLogout()}>
              退出
            </button>
          </div>
        </header>

        <main className={styles.main}>
          <Suspense
            fallback={
              <p className={styles.pageLoading} role="status">
                加载中…
              </p>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
