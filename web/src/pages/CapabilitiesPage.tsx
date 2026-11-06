import { useInfiniteQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import {
  CAPABILITY_VIEW_LABEL,
  CAPABILITY_VIEWS,
  fetchCapabilities,
  readCapabilityView,
} from "../api/capabilities.js";
import { ApiError } from "../api/client.js";
import { CapabilityCard } from "../components/capability/CapabilityCard.js";
import { DelegationMatrix } from "../components/capability/DelegationMatrix.js";
import { AsyncSection } from "../components/ui/AsyncSection.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { Tabs } from "../components/ui/Tabs.js";
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
  const [params, setParams] = useSearchParams();
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

  function selectView(next: string): void {
    const nextParams = new URLSearchParams(params);
    nextParams.set("view", next);
    setParams(nextParams, { replace: true });
  }

  const list =
    capabilities.length === 0 ? (
      <EmptyState title={EMPTY_HINT[view].title} description={EMPTY_HINT[view].description} />
    ) : (
      <div className={styles.grid}>
        {capabilities.map((capability) => (
          <CapabilityCard key={capability.id} capability={capability} view={view} now={now} />
        ))}
      </div>
    );

  return (
    <div className={styles.page}>
      <Tabs
        value={view}
        onValueChange={selectView}
        items={CAPABILITY_VIEWS.map((option) => ({
          key: option,
          label: CAPABILITY_VIEW_LABEL[option],
          content:
            option === view ? (
              <AsyncSection
                pending={capabilitiesQuery.isPending}
                error={
                  capabilitiesQuery.isError
                    ? capabilitiesQuery.error instanceof ApiError
                      ? capabilitiesQuery.error.message
                      : "授权列表加载失败"
                    : null
                }
                onRetry={() => void capabilitiesQuery.refetch()}
                hasMore={capabilitiesQuery.hasNextPage}
                fetchingMore={capabilitiesQuery.isFetchingNextPage}
                onLoadMore={() => void capabilitiesQuery.fetchNextPage()}
              >
                {list}
              </AsyncSection>
            ) : null,
        }))}
      />

      <DelegationMatrix />
    </div>
  );
}
