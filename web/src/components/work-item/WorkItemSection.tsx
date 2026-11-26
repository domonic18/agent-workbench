import { useInfiniteQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { useLocation, useSearchParams } from "react-router";
import { ApiError } from "../../api/client.js";
import {
  fetchWorkItems,
  readWorkItemFilter,
  type WorkItemListItem,
} from "../../api/work-items.js";
import { WORK_ITEM_ATTENTION_LABEL, WORK_ITEM_ATTENTION_ORDER } from "../../shared/labels.js";
import { Button } from "../ui/Button.js";
import { ChipGroup } from "../ui/Chip.js";
import { EmptyState } from "../ui/EmptyState.js";
import { ErrorState } from "../ui/ErrorState.js";
import { LoadingState } from "../ui/LoadingState.js";
import { SectionHeader } from "../ui/SectionHeader.js";
import { WorkItemTable } from "./WorkItemTable.js";
import styles from "./work-item-list.module.css";

const PAGE_SIZE = 20;

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "全部" },
  { key: "person", label: "需要人" },
  { key: "acceptance", label: "待验收" },
  { key: "blocked", label: "阻塞" },
  { key: "stalled", label: "异常停滞" },
];

function sortByAttention(items: readonly WorkItemListItem[]): WorkItemListItem[] {
  return [...items].sort((a, b) => {
    const byAttention =
      WORK_ITEM_ATTENTION_ORDER[a.attention] - WORK_ITEM_ATTENTION_ORDER[b.attention];
    if (byAttention !== 0) {
      return byAttention;
    }
    return b.updatedAt - a.updatedAt;
  });
}

export function WorkItemSection() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const attention = readWorkItemFilter(searchParams);

  const list = useInfiniteQuery({
    queryKey: ["work-items", attention ?? ""],
    queryFn: ({ pageParam }) =>
      fetchWorkItems({
        attention: attention ?? undefined,
        cursor: pageParam === "" ? undefined : pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  function selectFilter(key: string): void {
    const next = new URLSearchParams(searchParams);
    if (key === "") {
      next.delete("wi");
    } else {
      next.set("wi", key);
    }
    setSearchParams(next, { replace: true });
  }

  const items = sortByAttention(list.data?.pages.flatMap((page) => page.items) ?? []);
  const from = `${location.pathname}${location.search}`;

  return (
    <section className={styles.section} aria-label="工作事项">
      <SectionHeader title="工作事项" />
      <div className={styles.toolbar}>
        <ChipGroup
          label="注意力筛选"
          options={FILTERS}
          value={attention ?? ""}
          onValueChange={selectFilter}
        />
        <span className={styles.count}>
          {items.length} 个工作事项
          {attention === null ? "" : ` · 已筛选「${WORK_ITEM_ATTENTION_LABEL[attention]}」`}
        </span>
      </div>

      {list.isPending ? <LoadingState label="加载工作事项…" /> : null}

      {list.isError ? (
        <ErrorState
          message={list.error instanceof ApiError ? list.error.message : "工作事项加载失败"}
          onRetry={() => void list.refetch()}
        />
      ) : null}

      {items.length === 0 && !list.isPending && !list.isError ? (
        <EmptyState
          icon={<ClipboardList size={28} aria-hidden="true" />}
          title="还没有工作事项"
        />
      ) : (
        <WorkItemTable items={items} from={from} search={location.search} />
      )}

      {list.hasNextPage ? (
        <div>
          <Button
            size="sm"
            variant="secondary"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? "加载中…" : "加载更多工作事项"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
