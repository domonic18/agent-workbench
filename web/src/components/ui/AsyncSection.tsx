import type { ReactNode } from "react";
import { Button } from "./Button.js";
import { Skeleton } from "./Skeleton.js";

export interface AsyncSectionProps {
  /** 首屏加载中 */
  pending: boolean;
  /** 错误文案；非空即进错误态 */
  error: string | null;
  onRetry: () => void;
  /** 还有下一页 */
  hasMore: boolean;
  fetchingMore: boolean;
  onLoadMore: () => void;
  children: ReactNode;
}

export function AsyncSection({
  pending,
  error,
  onRetry,
  hasMore,
  fetchingMore,
  onLoadMore,
  children,
}: AsyncSectionProps) {
  if (pending) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} height={44} />
        ))}
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border border-danger-border rounded-md bg-danger-soft text-danger text-sm" role="alert">
        <span>{error}</span>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <>
      {children}
      {hasMore ? (
        <div className="flex justify-center mt-4">
          <Button variant="secondary" loading={fetchingMore} onClick={onLoadMore}>
            加载更多
          </Button>
        </div>
      ) : null}
    </>
  );
}
