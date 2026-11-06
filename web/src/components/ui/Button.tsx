import { Loader2 } from "lucide-react";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import styles from "./controls.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 提交中：显示转圈并禁用，防重复提交 */
  loading?: boolean;
  /** 左侧图标槽 */
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, icon, children, className, disabled, type, ...rest },
  ref,
) {
  const classes = [styles.button, styles[variant], styles[size], className]
    .filter((item): item is string => typeof item === "string" && item !== "")
    .join(" ");
  return (
    <button
      {...rest}
      ref={ref}
      type={type ?? "button"}
      disabled={disabled === true || loading}
      className={classes}
    >
      {loading ? (
        <Loader2 className={styles.spinner} size={16} aria-hidden="true" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});
