import { BookOpen, LayoutGrid, ListChecks, LogOut, ShieldCheck } from "lucide-react";
import { Suspense } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { logout } from "../../api/auth.js";
import { RealtimeProvider, useRealtimeStatus } from "../../api/stream.js";
import { APP_NAME, APP_NAME_EN, APP_VERSION } from "../../shared/app.js";
import { REALTIME_LABEL, REALTIME_TONE } from "../../shared/labels.js";
import { useTheme } from "../../shared/theme.js";
import { LogoIcon } from "../brand/LogoIcon.js";
import { Badge } from "../ui/Badge.js";
import { Menu, type MenuItem } from "../ui/Menu.js";
import { ThemeToggle } from "./ThemeToggle.js";
import styles from "./AppShell.module.css";

const NAV_GROUPS = [
  {
    label: "工作台",
    items: [
      { to: "/overview", label: "总览", icon: LayoutGrid },
      { to: "/tasks", label: "任务", icon: ListChecks },
    ],
  },
  {
    label: "治理",
    items: [
      { to: "/capabilities", label: "授权", icon: ShieldCheck },
      { to: "/knowledge", label: "知识", icon: BookOpen },
    ],
  },
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
    path: "/onboarding",
    title: "接入执行机",
    description: "下载产物、安装 aw-node、签发令牌并确认执行机上线",
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
  const { preference, setPreference } = useTheme();

  async function handleLogout(): Promise<void> {
    try {
      await logout();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  const menuItems: MenuItem[] = [
    { key: "account-heading", heading: "账号" },
    { key: "account-user", label: "管理员 · 本机", disabled: true },
    { key: "appearance-heading", heading: "外观" },
    {
      key: "theme-system",
      label: "跟随系统",
      checked: preference === "system",
      onSelect: () => {
        setPreference("system");
      },
    },
    {
      key: "theme-light",
      label: "明亮",
      checked: preference === "light",
      onSelect: () => {
        setPreference("light");
      },
    },
    {
      key: "theme-dark",
      label: "暗黑",
      checked: preference === "dark",
      onSelect: () => {
        setPreference("dark");
      },
    },
    {
      key: "logout",
      label: "退出登录",
      icon: <LogOut size={14} aria-hidden="true" />,
      tone: "danger",
      onSelect: () => {
        void handleLogout();
      },
    },
  ];

  return (
    <div className={styles.shell}>
      <nav className={styles.nav} aria-label="主导航">
        <div className={styles.brand}>
          <span className={styles.brandLogo} aria-hidden="true">
            <LogoIcon size={26} />
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandTitle}>{APP_NAME}</span>
            <span className={styles.brandSub}>{APP_NAME_EN}</span>
          </span>
        </div>

        <div className={styles.links}>
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className={styles.navGroup}>
              <div className={styles.navGroupLabel}>{group.label}</div>
              {group.items.map((item) => {
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
          ))}
        </div>

        <div className={styles.navFooter}>
          <Badge tone={env.local ? "positive" : "warning"} text={env.label} />
          <span className={styles.version}>{APP_VERSION}</span>
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
            <ThemeToggle />
            <Menu
              label="账号菜单"
              align="end"
              items={menuItems}
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  className={styles.avatarButton}
                  aria-label="账号菜单"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  onClick={toggle}
                >
                  <span className={styles.avatar} aria-hidden="true">
                    管
                  </span>
                </button>
              )}
            />
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
