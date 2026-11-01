import { useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { UNAUTHORIZED_EVENT } from "./api/client.js";
import { AppShell } from "./components/layout/AppShell.js";
import { LoginPage } from "./pages/LoginPage.js";
import { OverviewPage } from "./pages/OverviewPage.js";

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

export function App() {
  return (
    <BrowserRouter>
      <UnauthorizedRedirect />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AppShell />}>
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
