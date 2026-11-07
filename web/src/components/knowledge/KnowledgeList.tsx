import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client.js";
import {
  adoptKnowledgeEntry,
  archiveKnowledgeEntry,
  reindexKnowledgeEntry,
  type KnowledgeEntryDto,
  type KnowledgeView,
} from "../../api/knowledge.js";
import { formatDateTime, formatRelativeTime } from "../../shared/format.js";
import {
  KNOWLEDGE_EMBEDDING_LABEL,
  KNOWLEDGE_EMBEDDING_TONE,
  KNOWLEDGE_STATUS_LABEL,
  KNOWLEDGE_STATUS_TONE,
} from "../../shared/labels.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { Table, type TableColumn } from "../ui/Table.js";
import styles from "./knowledge-list.module.css";

export interface KnowledgeListProps {
  items: KnowledgeEntryDto[];
  view: KnowledgeView;
  search: string;
  now: number;
}

function detailPath(id: string, view: KnowledgeView, search: string): string {
  const params = new URLSearchParams({ view });
  if (search !== "") {
    params.set("q", search);
  }
  return `/knowledge/${encodeURIComponent(id)}?${params.toString()}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

type RowAction = "adopt" | "archive" | "reindex";

interface RowActionsProps {
  entry: KnowledgeEntryDto;
  pendingAction: RowAction | null;
  confirming: boolean;
  onAdopt: () => void;
  onArchive: () => void;
  onCancelArchive: () => void;
  onReindex: () => void;
}

/** 候选只有「采纳 / 丢弃」,逐条操作,不提供全选批量(03 §4.4) */
function RowActions({
  entry,
  pendingAction,
  confirming,
  onAdopt,
  onArchive,
  onCancelArchive,
  onReindex,
}: RowActionsProps) {
  const busy = pendingAction !== null;
  return (
    <div className={styles.rowActions}>
      {entry.status === "candidate" ? (
        <>
          <Button variant="primary" size="sm" onClick={onAdopt} disabled={busy}>
            {pendingAction === "adopt" ? "采纳中…" : "采纳"}
          </Button>
          <Button
            variant={confirming ? "danger" : "secondary"}
            size="sm"
            onClick={onArchive}
            disabled={busy}
          >
            {pendingAction === "archive" ? "丢弃中…" : confirming ? "确认丢弃" : "丢弃"}
          </Button>
          {confirming ? (
            <Button variant="secondary" size="sm" onClick={onCancelArchive}>
              取消
            </Button>
          ) : null}
        </>
      ) : null}
      {entry.embeddingStatus === "ready" ? null : (
        <Button
          variant="secondary"
          size="sm"
          onClick={onReindex}
          disabled={busy}
          title="重新建立关键词与向量索引"
        >
          {pendingAction === "reindex" ? "索引中…" : "重试索引"}
        </Button>
      )}
    </div>
  );
}

export function KnowledgeList({ items, view, search, now }: KnowledgeListProps) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<{ id: string; action: RowAction } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(
    id: string,
    action: RowAction,
    task: () => Promise<unknown>,
    fallback: string,
  ) {
    setPending({ id, action });
    setError(null);
    try {
      await task();
      await queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    } catch (caught) {
      setError(errorMessage(caught, fallback));
    } finally {
      setPending(null);
      setConfirmId(null);
    }
  }

  const actionsOf = (entry: KnowledgeEntryDto): RowActionsProps => ({
    entry,
    pendingAction: pending?.id === entry.id ? pending.action : null,
    confirming: confirmId === entry.id,
    onAdopt: () =>
      void run(entry.id, "adopt", () => adoptKnowledgeEntry(entry.id), "采纳失败"),
    onArchive: () => {
      if (confirmId !== entry.id) {
        setConfirmId(entry.id);
        return;
      }
      void run(entry.id, "archive", () => archiveKnowledgeEntry(entry.id), "丢弃失败");
    },
    onCancelArchive: () => setConfirmId(null),
    onReindex: () =>
      void run(entry.id, "reindex", () => reindexKnowledgeEntry(entry.id), "索引重试失败"),
  });

  const columns: TableColumn<KnowledgeEntryDto>[] = [
    {
      key: "title",
      header: "标题",
      width: "38%",
      render: (entry) => (
        <>
          <Link to={detailPath(entry.id, view, search)} className={styles.title} title={entry.path}>
            {entry.title}
          </Link>
          <span className={styles.subline}>
            {entry.summary === "" ? entry.path : entry.summary}
          </span>
        </>
      ),
    },
    {
      key: "category",
      header: "分类",
      width: "10%",
      render: (entry) => (entry.category === "" ? "—" : entry.category),
    },
    {
      key: "status",
      header: "状态",
      width: "10%",
      render: (entry) => (
        <Badge tone={KNOWLEDGE_STATUS_TONE[entry.status]} text={KNOWLEDGE_STATUS_LABEL[entry.status]} />
      ),
    },
    {
      key: "embedding",
      header: "索引",
      width: "10%",
      render: (entry) =>
        entry.embeddingStatus === "ready" ? (
          <span className={styles.muted}>已索引</span>
        ) : (
          <Badge
            tone={KNOWLEDGE_EMBEDDING_TONE[entry.embeddingStatus]}
            text={KNOWLEDGE_EMBEDDING_LABEL[entry.embeddingStatus]}
          />
        ),
    },
    {
      key: "updated",
      header: "更新时间",
      width: "12%",
      render: (entry) => (
        <span title={formatDateTime(entry.updatedAt)}>{formatRelativeTime(entry.updatedAt, now)}</span>
      ),
    },
    {
      key: "actions",
      header: "操作",
      width: "20%",
      render: (entry) => <RowActions {...actionsOf(entry)} />,
    },
  ];

  return (
    <div className={styles.wrap}>
      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.tableArea}>
        <Table columns={columns} rows={items} rowKey={(entry) => entry.id} minWidth="760px" fixedLayout />
      </div>

      <ul className={styles.cards}>
        {items.map((entry) => (
          <li key={entry.id} className={styles.card}>
            <div className={styles.cardTop}>
              <Link to={detailPath(entry.id, view, search)} className={styles.cardTitle}>
                {entry.title}
              </Link>
              <Badge
                tone={KNOWLEDGE_STATUS_TONE[entry.status]}
                text={KNOWLEDGE_STATUS_LABEL[entry.status]}
              />
            </div>
            <div className={styles.cardMeta}>
              <span>{entry.category === "" ? "未分类" : entry.category}</span>
              <span>{formatRelativeTime(entry.updatedAt, now)}</span>
              {entry.embeddingStatus === "ready" ? null : (
                <Badge
                  tone={KNOWLEDGE_EMBEDDING_TONE[entry.embeddingStatus]}
                  text={KNOWLEDGE_EMBEDDING_LABEL[entry.embeddingStatus]}
                />
              )}
            </div>
            <RowActions {...actionsOf(entry)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
