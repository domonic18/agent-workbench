import type { CSSProperties } from "react";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** 圆形头像位 */
  circle?: boolean;
}

export function Skeleton({ width = "100%", height = 16, circle = false }: SkeletonProps) {
  const style: CSSProperties = {
    width,
    height,
  };
  return (
    <span
      className={`rounded-md bg-gradient-to-r from-surface-3 via-surface-2 to-surface-3 bg-[length:400%_100%] animate-shimmer ${
        circle ? "rounded-full" : ""
      }`}
      style={style}
      aria-hidden="true"
    />
  );
}
