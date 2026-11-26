import {
  BookMarked,
  BookOpen,
  CalendarClock,
  KeyRound,
  LayoutGrid,
  ListChecks,
  LogOut,
  Plug,
  Settings,
  Share2,
  ShieldCheck,
} from "lucide-react";
import { Suspense, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { logout } from "../../api/auth.js";
import { RealtimeProvider, useRealtimeStatus } from "../../api/stream.js";
import { APP_NAME, APP_NAME_EN, APP_VERSION } from "../../shared/app.js";
import { REALTIME_LABEL, REALTIME_TONE } from "../../shared/labels.js";
import { useTheme } from "../../shared/theme.js";
import { cn } from "../../lib/utils.js";
import { LogoIcon } from "../brand/LogoIcon.js";
import { ChangePasswordDialog } from "../identity/ChangePasswordDialog.js";
import { Badge } from "../ui/Badge.js";
import { Menu, type MenuItem } from "../ui/Menu.js";
import { ThemeToggle } from "./ThemeToggle.js";

const NAV_GROUPS = [
  {
    label: "工作台",
    items: [
      { to: "/overview", label: "总览", icon: LayoutGrid },
      { to: "/tasks", label: "任务", icon: ListChecks },
      { to: "/schedules", label: "定时任务", icon: CalendarClock },
    ],
  },
  {
    label: "治理",
    items: [
      { to: "/capabilities", label: "授权", icon: ShieldCheck },
      { to: "/delegation", label: "委派", icon: Share2 },
      { to: "/knowledge", label: "知识", icon: BookOpen },
      { to: "/settings", label: "设置", icon: Settings },
    ],
  },
  {
    label: "接入",
    items: [
      { to: "/agent-access", label: "协作接入", icon: Plug },
      { to: "/agent-guide", label: "Agent 手册", icon: BookMarked },
    ],
  },
] as const;

/** 内容区放开窄栏上限的屏:图版面需要整块横向空间 */
const WIDE_ROUTES = ["/delegation"];

const PAGE_META: { path: string; title: string; description: string }[] = [
  {
    path: "/overview",
    title: "总览",
    description: "Agent 在线状态、当前任务，以及需要你看一眼的事项",
  },
  {
    path: "/work-items",
    title: "工作事项",
    description: "业务事项的目标、状态、关联工作与永久时间线",
  },
  {
    path: "/tasks",
    title: "任务",
    description: "工作台里正在流转与已收口的任务",
  },
  {
    path: "/schedules",
    title: "定时任务",
    description: "执行机上按计划自动触发的活：频率、下次执行与对应机器人",
  },
  {
    path: "/delegation",
    title: "委派关系",
    description: "谁能找谁：Agent 之间的委派规则与委派目标组",
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
  {
    path: "/agent-access",
    title: "协作接入",
    description: "MCP 端点、Agent 名册与各客户端就绪配置",
  },
  {
    path: "/agent-guide",
    title: "Agent 手册",
    description: "A2A 协作规范正文与可安装的 SKILL.md",
  },
  {
    path: "/settings",
    title: "设置",
    description: "控制台环境配置与后台管理",
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
  const [passwordDialog, setPasswordDialog] = useState(false);

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
    {
      key: "change-password",
      label: "修改口令",
      icon: <KeyRound size={14} aria-hidden="true" />,
      onSelect: () => {
        setPasswordDialog(true);
      },
    },
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
    <div className="flex min-h-screen bg-background max-md:flex-col">
      <nav
        className="sticky top-0 flex w-sidebar shrink-0 grow-0 basis-sidebar flex-col border-r border-border bg-surface text-text-secondary max-md:static max-md:h-auto max-md:w-auto max-md:basis-auto max-md:flex-row max-md:flex-wrap max-md:items-center"
        aria-label="主导航"
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4 max-md:border-b-0 max-md:px-4 max-md:py-3">
          <span className="inline-flex text-accent" aria-hidden="true">
            <LogoIcon size={26} />
          </span>
          <span className="block min-w-0 max-md:hidden">
            <span className="block text-md font-bold text-foreground">{APP_NAME}</span>
            <span className="mt-1 block text-xs text-muted">{APP_NAME_EN}</span>
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4 max-md:order-1 max-md:basis-full max-md:flex-row max-md:gap-1 max-md:overflow-x-auto max-md:px-3 max-md:py-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-1 max-md:flex-row max-md:gap-1">
              <div className="px-3 text-2xs font-semibold uppercase tracking-wide text-muted max-md:hidden">
                {group.label}
              </div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        "flex h-control-md items-center gap-3 rounded-md px-3 text-sm font-medium no-underline transition-colors duration-fast",
                        "hover:bg-surface-2 hover:text-foreground",
                        isActive && "bg-surface-2 font-semibold text-foreground",
                        "max-md:inline-flex max-md:h-auto max-md:min-h-touch max-md:shrink-0 max-md:whitespace-nowrap",
                      )
                    }
                  >
                    <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 max-md:order-0 max-md:ml-auto max-md:px-4 max-md:py-2">
          <Badge tone={env.local ? "positive" : "warning"} text={env.label} />
          <span className="text-xs text-muted">{APP_VERSION}</span>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-topbar items-center gap-4 border-b border-border bg-header-bg px-6 max-md:h-auto max-md:px-4 max-md:py-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="m-0 text-lg font-semibold text-foreground">{meta.title}</h1>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm text-muted max-md:hidden">
              {meta.description}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge tone={REALTIME_TONE[realtime]} text={REALTIME_LABEL[realtime]} />
            <ThemeToggle />
            <Menu
              label="账号菜单"
              align="end"
              items={menuItems}
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  className="inline-flex h-[var(--size-avatar)] w-[var(--size-avatar)] items-center justify-center rounded-full border-none bg-transparent p-0"
                  aria-label="账号菜单"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  onClick={toggle}
                >
                  <span
                    className="flex h-full w-full items-center justify-center rounded-full bg-avatar-bg text-xs font-bold text-avatar-text"
                    aria-hidden="true"
                  >
                    管
                  </span>
                </button>
              )}
            />
          </div>
        </header>

        {/* 委派屏是图版面,内容区按窄栏排会把画布压扁——这一屏放开宽度 */}
        <main
          className={cn(
            "mx-auto min-w-0 w-full flex-1 p-6 max-md:p-4",
            WIDE_ROUTES.some((path) => location.pathname.startsWith(path))
              ? "max-w-none"
              : "max-w-content-narrow",
          )}
        >
          <Suspense
            fallback={
              <p className="text-md text-muted" role="status">
                加载中…
              </p>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>

      {passwordDialog ? (
        <ChangePasswordDialog onClose={() => setPasswordDialog(false)} />
      ) : null}
    </div>
  );
}
