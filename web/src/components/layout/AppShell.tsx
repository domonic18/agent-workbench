import { Suspense } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { logout } from "../../api/auth.js";
import styles from "./AppShell.module.css";

function NavIcon({ name }: { name: "overview" | "tasks" | "auth" | "knowledge" }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "overview":
      return (
        <svg {...common}>
          <rect x="2" y="2" width="5" height="5" rx="1.2" />
          <rect x="9" y="2" width="5" height="5" rx="1.2" />
          <rect x="2" y="9" width="5" height="5" rx="1.2" />
          <rect x="9" y="9" width="5" height="5" rx="1.2" />
        </svg>
      );
    case "tasks":
      return (
        <svg {...common}>
          <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
          <circle cx="2.5" cy="4" r="0.8" fill="currentColor" stroke="none" />
          <circle cx="2.5" cy="8" r="0.8" fill="currentColor" stroke="none" />
          <circle cx="2.5" cy="12" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case "auth":
      return (
        <svg {...common}>
          <rect x="3" y="7" width="10" height="7" rx="1.6" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
        </svg>
      );
    case "knowledge":
      return (
        <svg {...common}>
          <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2H13v11H4.5A1.5 1.5 0 0 0 3 14.5z" />
          <path d="M3 13.5A1.5 1.5 0 0 1 4.5 12H13" />
        </svg>
      );
  }
}

function pageTitle(pathname: string): string {
  if (pathname.startsWith("/tasks")) {
    return "任务";
  }
  if (pathname.startsWith("/capabilities")) {
    return "授权";
  }
  if (pathname.startsWith("/knowledge")) {
    return "知识";
  }
  return "总览";
}

function environment(): { label: string; local: boolean } {
  const host = window.location.host;
  const local = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
  return { label: local ? `本机 ${host}` : `穿透 ${host}`, local };
}

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const env = environment();

  async function handleLogout(): Promise<void> {
    try {
      await logout();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.nav}>
        <div className={styles.brand}>
          <div className={styles.brandTitle}>智能体工作台</div>
          <div className={styles.brandSub}>控制台 · v0.1</div>
        </div>
        <div className={styles.links}>
          <NavLink
            to="/overview"
            className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ""}`}
          >
            <span className={styles.icon}>
              <NavIcon name="overview" />
            </span>
            总览
          </NavLink>
          <NavLink
            to="/tasks"
            className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ""}`}
          >
            <span className={styles.icon}>
              <NavIcon name="tasks" />
            </span>
            任务
          </NavLink>
          <NavLink
            to="/capabilities"
            className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ""}`}
          >
            <span className={styles.icon}>
              <NavIcon name="auth" />
            </span>
            授权
          </NavLink>
          <NavLink
            to="/knowledge"
            className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ""}`}
          >
            <span className={styles.icon}>
              <NavIcon name="knowledge" />
            </span>
            知识
          </NavLink>
        </div>
      </nav>

      <div className={styles.body}>
        <header className={styles.topbar}>
          <h1 className={styles.pageTitle}>{pageTitle(location.pathname)}</h1>
          <span className={env.local ? styles.envLocal : styles.envTunnel}>{env.label}</span>
          <div className={styles.topbarRight}>
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
