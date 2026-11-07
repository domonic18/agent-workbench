import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../shared/theme.js";
import { IconButton } from "../ui/IconButton.js";

/** 顶栏主题开关：在明亮与暗黑之间直接切换（跟随系统在账号菜单里选） */
export function ThemeToggle() {
  const { resolved, toggleTheme } = useTheme();
  const dark = resolved === "dark";

  return (
    <IconButton
      variant="ghost"
      label={dark ? "切换到明亮模式" : "切换到暗黑模式"}
      icon={dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
      onClick={toggleTheme}
    />
  );
}
