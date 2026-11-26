import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const linkButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 border rounded-md font-semibold whitespace-nowrap no-underline transition-colors",
  {
    variants: {
      variant: {
        primary: "border-transparent bg-accent text-on-accent hover:bg-accent-hover",
        secondary: "border-border bg-surface text-foreground hover:bg-surface-3 hover:border-border-strong",
      },
      size: {
        sm: "h-control-sm px-3 text-sm",
        md: "h-control-md px-4 text-md",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface LinkButtonProps extends VariantProps<typeof linkButtonVariants> {
  href: string;
  children: ReactNode;
  icon?: ReactNode;
  /** 下载文件名；给出即带 download 属性 */
  download?: boolean | string;
  target?: string;
  rel?: string;
  className?: string;
}

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
  return (
    <a
      className={cn(linkButtonVariants({ variant, size }), "max-md:min-h-touch", className)}
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
