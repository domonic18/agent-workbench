import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import {
  CAPABILITY_VIEW_LABEL,
  CAPABILITY_VIEWS,
  fetchCapabilities,
  readCapabilityView,
} from "../api/capabilities.js";
import { ApiError } from "../api/client.js";
import { CapabilityCard } from "../components/capability/CapabilityCard.js";
import { DelegationMatrix } from "../components/capability/DelegationMatrix.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { useNow } from "../shared/useNow.js";
import styles from "./CapabilitiesPage.module.css";

const EMPTY_HINT: Record<
  (typeof CAPABILITY_VIEWS)[number],
  { title: string; description: string }
> = {
  pending: {
    title: "没有待批授权",
    description: "Agent 请求受限操作时，授权申请会在这里等待你批准或拒绝。",
  },
  active: {
    title: "没有生效中的授权",
    description: "批准并签发成功的授权会显示在这里，直到过期或被吊销。",
  },
  history: {
    title: "暂无历史授权",
    description: "过期、已吊销与签发失败的授权会留在这里备查。",
  },
};

export function CapabilitiesPage() {
  const [params] = useSearchParams();
  const view = readCapabilityView(params);
  const now = useNow(1_000);

  const capabilitiesQuery = useInfiniteQuery({
    queryKey: ["capabilities", view],
    queryFn: ({ pageParam }) =>
      fetchCapabilities(view, pageParam === null ? undefined : pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    retry: (count, caught) =>
      !(caught instanceof ApiError && caught.status === 401) && count < 2,
  });

  const capabilities = capabilitiesQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className={styles.page}>
      <nav className={styles.tabs} aria-label="授权状态">
        {CAPABILITY_VIEWS.map((option) => (
          <Link
            key={option}
            to={`/capabilities?view=${option}`}
            replace
            className={`${styles.tab} ${option === view ? styles.tabActive : ""}`}
            aria-current={option === view ? "page" : undefined}
          >
            {CAPABILITY_VIEW_LABEL[option]}
          </Link>
        ))}
      </nav>

      {capabilitiesQuery.isPending ? <p className={styles.loading}>加载中…</p> : null}

      {capabilitiesQuery.isError ? (
        <div className={styles.errorBox} role="alert">
          <span>
            {capabilitiesQuery.error instanceof ApiError
              ? capabilitiesQuery.error.message
              : "授权列表加载失败"}
          </span>
          <button
            type="button"
            className={styles.retry}
            onClick={() => void capabilitiesQuery.refetch()}
          >
            重试
          </button>
        </div>
      ) : null}

      {!capabilitiesQuery.isPending && !capabilitiesQuery.isError ? (
        capabilities.length === 0 ? (
          <EmptyState
            title={EMPTY_HINT[view].title}
            description={EMPTY_HINT[view].description}
          />
        ) : (
          <ul className={styles.list}>
            {capabilities.map((capability) => (
              <li key={capability.id}>
                <CapabilityCard capability={capability} view={view} now={now} />
              </li>
            ))}
          </ul>
        )
      ) : null}

      {capabilitiesQuery.hasNextPage ? (
        <button
          type="button"
          className={styles.more}
          disabled={capabilitiesQuery.isFetchingNextPage}
          onClick={() => void capabilitiesQuery.fetchNextPage()}
        >
          {capabilitiesQuery.isFetchingNextPage ? "加载中…" : "加载更多"}
        </button>
      ) : null}

      <DelegationMatrix />
    </div>
  );
}
