import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const toneIconVariants = cva("inline-flex", {
  variants: {
    tone: {
      positive: "text-positive",
      warning: "text-warning",
      danger: "text-danger",
      info: "text-info",
      muted: "text-muted",
    },
  },
  defaultVariants: {
    tone: "muted",
  },
});

export interface ToneIconProps extends VariantProps<typeof toneIconVariants> {
  icon: ReactNode;
}

export function ToneIcon({ tone = "muted", icon }: ToneIconProps) {
  return (
    <span className={cn(toneIconVariants({ tone }))} aria-hidden="true">
      {icon}
    </span>
  );
}
