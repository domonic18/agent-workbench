import type { ReactNode } from "react";
import { Button } from "./Button.js";
import { Skeleton } from "./Skeleton.js";
import styles from "./surfaces.module.css";

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

/** 列表三态（加载 / 出错 / 有内容）+ 分页加载，收敛各屏重复的状态样板 */
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
      <div className={styles.skeletonList}>
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} height={44} />
        ))}
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className={styles.errorBanner} role="alert">
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
        <div className={styles.loadMore}>
          <Button variant="secondary" loading={fetchingMore} onClick={onLoadMore}>
            加载更多
          </Button>
        </div>
      ) : null}
    </>
  );
}
