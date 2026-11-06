import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { ButtonSize } from "./Button.js";
import styles from "./controls.module.css";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 无障碍名称：图标按钮没有可见文字，必须显式给出 */
  label: string;
  size?: ButtonSize;
  icon: ReactNode;
  /** surface 带边框（默认）；ghost 无边框，hover 才显形 */
  variant?: "surface" | "ghost";
}

const VARIANT_CLASS = {
  surface: undefined,
  ghost: styles.iconButtonGhost,
} as const;

/** 纯图标可点区：触达尺寸不小于 44px 时用 lg（03 §6 移动适配） */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", icon, variant = "surface", className, type, ...rest },
  ref,
) {
  const classes = [styles.iconButton, styles[size], VARIANT_CLASS[variant], className]
    .filter((item): item is string => typeof item === "string" && item !== "")
    .join(" ");
  return (
    <button {...rest} ref={ref} type={type ?? "button"} aria-label={label} title={label} className={classes}>
      {icon}
    </button>
  );
});
