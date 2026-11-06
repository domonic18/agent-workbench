import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Outlet, useSearchParams } from "react-router";
import { ApiError } from "../api/client.js";
import {
  fetchKnowledge,
  KNOWLEDGE_VIEW_LABEL,
  KNOWLEDGE_VIEWS,
  readKnowledgeSearch,
  readKnowledgeView,
} from "../api/knowledge.js";
import { KnowledgeList } from "../components/knowledge/KnowledgeList.js";
import { AsyncSection } from "../components/ui/AsyncSection.js";
import { Badge } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { Input } from "../components/ui/Field.js";
import { PageFooter } from "../components/ui/PageFooter.js";
import { Tabs } from "../components/ui/Tabs.js";
import { useNow } from "../shared/useNow.js";
import styles from "./KnowledgePage.module.css";

const EMPTY_HINT: Record<
  (typeof KNOWLEDGE_VIEWS)[number],
  { title: string; description: string }
> = {
  active: {
    title: "知识库还没有生效条目",
    description: "Agent 写入的知识先进入待采纳，人工采纳后才会参与检索。",
  },
  candidate: {
    title: "没有待采纳的知识",
    description: "Agent 通过 kb_write 写入的内容会出现在这里，需要逐条审阅。",
  },
  archived: {
    title: "没有已归档条目",
    description: "被丢弃或主动归档的知识会留在这里备查。",
  },
};

export function KnowledgePage() {
  const [params, setParams] = useSearchParams();
  const view = readKnowledgeView(params);
  const search = readKnowledgeSearch(params);
  const now = useNow(30_000);
  const [term, setTerm] = useState(search);

  useEffect(() => {
    setTerm(search);
  }, [search]);

  const knowledgeQuery = useInfiniteQuery({
    queryKey: ["knowledge", view, search],
    queryFn: ({ pageParam }) =>
      fetchKnowledge(view, {
        ...(search === "" ? {} : { search }),
        ...(pageParam === null ? {} : { cursor: pageParam }),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    retry: (count, caught) =>
      !(caught instanceof ApiError && caught.status === 401) && count < 2,
  });

  const items = knowledgeQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const counts = knowledgeQuery.data?.pages[0]?.counts;

  function selectView(target: string): void {
    const next = new URLSearchParams(params);
    next.set("view", target);
    setParams(next, { replace: true });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next = new URLSearchParams(params);
    const trimmed = term.trim();
    if (trimmed === "") {
      next.delete("q");
    } else {
      next.set("q", trimmed);
    }
    setParams(next, { replace: true });
  }

  function clearSearch(): void {
    const next = new URLSearchParams(params);
    next.delete("q");
    setParams(next, { replace: true });
  }

  const searchForm = (
    <form className={styles.search} role="search" onSubmit={submitSearch}>
      <Input
        type="search"
        value={term}
        placeholder="搜索标题、摘要或正文"
        aria-label="搜索知识"
        onChange={(event) => setTerm(event.target.value)}
      />
      <Button type="submit" variant="primary">
        搜索
      </Button>
      {search === "" ? null : (
        <Button variant="ghost" size="sm" onClick={clearSearch}>
          清除
        </Button>
      )}
    </form>
  );

  const list =
    items.length === 0 ? (
      <EmptyState
        title={search === "" ? EMPTY_HINT[view].title : "没有匹配的知识"}
        description={
          search === "" ? EMPTY_HINT[view].description : "换个关键词，或清除搜索后重试。"
        }
      />
    ) : (
      <KnowledgeList items={items} view={view} search={search} now={now} />
    );

  return (
    <div className={styles.page}>
      <Tabs
        value={view}
        onValueChange={selectView}
        items={KNOWLEDGE_VIEWS.map((option) => ({
          key: option,
          label: (
            <>
              {KNOWLEDGE_VIEW_LABEL[option]}
              {option === "candidate" ? (
                <Badge tone="warning" text={counts?.candidate ?? 0} />
              ) : null}
            </>
          ),
          content:
            option === view ? (
              <>
                {searchForm}
                <AsyncSection
                  pending={knowledgeQuery.isPending}
                  error={
                    knowledgeQuery.isError
                      ? knowledgeQuery.error instanceof ApiError
                        ? knowledgeQuery.error.message
                        : "知识列表加载失败"
                      : null
                  }
                  onRetry={() => void knowledgeQuery.refetch()}
                  hasMore={knowledgeQuery.hasNextPage}
                  fetchingMore={knowledgeQuery.isFetchingNextPage}
                  onLoadMore={() => void knowledgeQuery.fetchNextPage()}
                >
                  {list}
                </AsyncSection>
              </>
            ) : null,
        }))}
      />

      <PageFooter>
        只有已生效条目参与 Agent 检索；候选必须逐条采纳，避免 Agent 自己决定知识库。
      </PageFooter>

      <Outlet />
    </div>
  );
}
