import type { ReactNode } from "react";
import styles from "./controls.module.css";

export interface LinkButtonProps {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
  icon?: ReactNode;
  /** 下载文件名；给出即带 download 属性 */
  download?: boolean | string;
  target?: string;
  rel?: string;
  className?: string;
}

/**
 * 长得像按钮的链接：下载直链与站外链接需要 a 标签语义，
 * 不能用 Button 代替（Button 不支持 href/download）。
 */
export function LinkButton({
  href,
  children,
  variant = "primary",
  size = "md",
  icon,
  download,
  target,
  rel,
  className,
}: LinkButtonProps) {
  const classes = [styles.linkButton, styles[variant], styles[size], className]
    .filter((item): item is string => typeof item === "string" && item !== "")
    .join(" ");
  return (
    <a
      className={classes}
      href={href}
      {...(download === undefined ? {} : { download })}
      {...(target === undefined ? {} : { target })}
      {...(rel === undefined ? {} : { rel })}
    >
      {icon}
      {children}
    </a>
  );
}
