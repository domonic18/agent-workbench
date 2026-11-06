import { lazy, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { UNAUTHORIZED_EVENT } from "./api/client.js";
import { bootstrapStatus } from "./api/bootstrap.js";
import { AppShell } from "./components/layout/AppShell.js";
import { ToastProvider } from "./components/ui/Toast.js";
import { LoginPage } from "./pages/LoginPage.js";

/** 路由级懒加载:首屏只带导航与登录,总览/任务/详情按需加载(03 §8) */
const OverviewPage = lazy(async () => {
  const module = await import("./pages/OverviewPage.js");
  return { default: module.OverviewPage };
});
const TasksPage = lazy(async () => {
  const module = await import("./pages/TasksPage.js");
  return { default: module.TasksPage };
});
const TaskDrawerRoute = lazy(async () => {
  const module = await import("./pages/TaskDrawerRoute.js");
  return { default: module.TaskDrawerRoute };
});
const CapabilitiesPage = lazy(async () => {
  const module = await import("./pages/CapabilitiesPage.js");
  return { default: module.CapabilitiesPage };
});
const KnowledgePage = lazy(async () => {
  const module = await import("./pages/KnowledgePage.js");
  return { default: module.KnowledgePage };
});
const KnowledgeDetailRoute = lazy(async () => {
  const module = await import("./pages/KnowledgeDetailRoute.js");
  return { default: module.KnowledgeDetailRoute };
});
const SetupPage = lazy(async () => {
  const module = await import("./pages/SetupPage.js");
  return { default: module.SetupPage };
});

/** 任意 API 401 统一回登录页,并记住原路径(03 §3) */
function UnauthorizedRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const path = `${location.pathname}${location.search}`;

  useEffect(() => {
    const handleUnauthorized = (): void => {
      if (location.pathname === "/login") {
        return;
      }
      navigate(`/login?next=${encodeURIComponent(path)}`, { replace: true });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [navigate, location.pathname, path]);

  return null;
}

/** 初始化未完成时强制进入 /setup;已就绪或仅探测(401)则放行(03 §4.0) */
function BootstrapGuard() {
  const location = useLocation();
  const query = useQuery({
    queryKey: ["bootstrap", "status"],
    queryFn: bootstrapStatus,
    retry: false,
  });
  if (query.isLoading) {
    return <Outlet />;
  }
  if (query.error !== null) {
    // 未认证(401)交 UnauthorizedRedirect 处理;其余异常不阻断导航
    return <Outlet />;
  }
  if (query.data !== undefined && query.data.phase !== "ready" && location.pathname !== "/setup") {
    return <Navigate to="/setup" replace />;
  }
  return <Outlet />;
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <UnauthorizedRedirect />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route element={<AppShell />}>
            <Route element={<BootstrapGuard />}>
              <Route path="/overview" element={<OverviewPage />} />
              <Route path="/tasks" element={<TasksPage />}>
                <Route path=":id" element={<TaskDrawerRoute />} />
              </Route>
              <Route path="/capabilities" element={<CapabilitiesPage />} />
              <Route path="/knowledge" element={<KnowledgePage />}>
                <Route path=":id" element={<KnowledgeDetailRoute />} />
              </Route>
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Route>
          </Route>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
