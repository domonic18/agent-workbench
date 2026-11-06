import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "../../shared/theme.js";
import styles from "./ThemeToggle.module.css";

const NEXT: Record<ThemePreference, ThemePreference> = {
  light: "dark",
  dark: "system",
  system: "light",
};

const ICON: Record<ThemePreference, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Laptop,
};

const LABEL: Record<ThemePreference, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

export function ThemeToggle({ variant = "surface" }: { variant?: "surface" | "sidebar" }) {
  const { preference, resolved, setPreference } = useTheme();
  const Icon = ICON[preference];

  return (
    <button
      type="button"
      className={`${styles.toggle} ${variant === "sidebar" ? styles.onDark : ""}`}
      title={`主题：${LABEL[preference]}（当前${resolved === "dark" ? "深色" : "浅色"}）`}
      aria-label={`切换主题，当前${LABEL[preference]}`}
      onClick={() => setPreference(NEXT[preference])}
    >
      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
