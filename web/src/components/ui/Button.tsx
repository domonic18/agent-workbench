import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 border font-semibold whitespace-nowrap transition-colors disabled:opacity-55",
  {
    variants: {
      variant: {
        primary: "border-transparent bg-accent text-on-accent hover:bg-accent-hover",
        secondary: "border-border bg-surface text-foreground hover:bg-surface-3 hover:border-border-strong",
        ghost: "border-transparent bg-transparent text-text-secondary hover:bg-surface-3 hover:text-foreground",
        danger: "border-transparent bg-danger text-white hover:brightness-[0.92]",
      },
      size: {
        sm: "h-control-sm px-3 text-sm rounded-md",
        md: "h-control-md px-4 text-sm rounded-md",
        lg: "h-control-lg px-6 text-lg rounded-md",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size">,
    VariantProps<typeof buttonVariants> {
  /** 提交中：显示转圈并禁用，防重复提交 */
  loading?: boolean;
  /** 左侧图标槽 */
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, icon, children, className, disabled, type, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type ?? "button"}
      disabled={disabled === true || loading}
      className={cn(buttonVariants({ variant, size }), className)}
    >
      {loading ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : icon}
      {children}
    </button>
  );
});
