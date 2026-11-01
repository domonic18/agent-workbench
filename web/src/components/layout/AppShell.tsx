import { NavLink, Outlet, useNavigate } from "react-router";
import { logout } from "../../api/auth.js";
import styles from "./AppShell.module.css";

const PENDING_SECTIONS = ["任务", "授权", "知识"] as const;

export function AppShell() {
  const navigate = useNavigate();

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
        <div className={styles.brand}>Agent 工作台</div>
        <NavLink
          to="/overview"
          className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ""}`}
        >
          总览
        </NavLink>
        {PENDING_SECTIONS.map((section) => (
          <span
            key={section}
            className={styles.disabled}
            aria-disabled="true"
            title="后续里程碑接入"
          >
            {section}
          </span>
        ))}
        <div className={styles.spacer} />
        <button type="button" className={styles.logout} onClick={() => void handleLogout()}>
          退出登录
        </button>
      </nav>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
