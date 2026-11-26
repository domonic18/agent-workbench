import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";
import type { ButtonSize } from "./Button.js";

const iconButtonVariants = cva(
  "inline-flex items-center justify-center p-0 border rounded-md bg-surface text-text-secondary transition-colors disabled:opacity-55",
  {
    variants: {
      variant: {
        surface: "border-border hover:bg-surface-3 hover:border-border-strong hover:text-foreground",
        ghost: "border-transparent bg-transparent hover:bg-accent-soft hover:text-accent",
      },
      size: {
        sm: "w-control-sm h-control-sm",
        md: "w-control-md h-control-md",
        lg: "w-control-lg h-control-lg",
      },
    },
    defaultVariants: {
      variant: "surface",
      size: "md",
    },
  },
);

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size">,
    VariantProps<typeof iconButtonVariants> {
  /** 无障碍名称：图标按钮没有可见文字，必须显式给出 */
  label: string;
  size?: ButtonSize;
  icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", icon, variant = "surface", className, type, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={cn(iconButtonVariants({ variant, size }), className)}
    >
      {icon}
    </button>
  );
});
