import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center gap-1 px-2 py-1 border rounded-sm text-xs leading-4 whitespace-nowrap",
  {
    variants: {
      tone: {
        positive: "text-positive bg-positive-soft border-transparent",
        warning: "text-warning bg-warning-soft border-transparent",
        danger: "text-danger bg-danger-soft border-transparent",
        info: "text-info bg-info-soft border-transparent",
        muted: "text-muted bg-muted-soft border-transparent",
      },
    },
    defaultVariants: {
      tone: "muted",
    },
  },
);

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  text: ReactNode;
  icon?: ReactNode;
}

export function Badge({ tone = "muted", text, icon }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }))}>
      {icon}
      {text}
    </span>
  );
}
