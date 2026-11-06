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
          <button
            type="button"
            className={styles.primary}
            onClick={onAdopt}
            disabled={busy}
          >
            {pendingAction === "adopt" ? "采纳中…" : "采纳"}
          </button>
          <button
            type="button"
            className={confirming ? styles.danger : styles.secondary}
            onClick={onArchive}
            disabled={busy}
          >
            {pendingAction === "archive" ? "丢弃中…" : confirming ? "确认丢弃" : "丢弃"}
          </button>
          {confirming ? (
            <button type="button" className={styles.secondary} onClick={onCancelArchive}>
              取消
            </button>
          ) : null}
        </>
      ) : null}
      {entry.embeddingStatus === "ready" ? null : (
        <button
          type="button"
          className={styles.secondary}
          onClick={onReindex}
          disabled={busy}
          title="重新建立关键词与向量索引"
        >
          {pendingAction === "reindex" ? "索引中…" : "重试索引"}
        </button>
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

  return (
    <div className={styles.wrap}>
      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>标题</th>
              <th>分类</th>
              <th>状态</th>
              <th>索引</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <Link
                    to={detailPath(entry.id, view, search)}
                    className={styles.title}
                    title={entry.path}
                  >
                    {entry.title}
                  </Link>
                  <span className={styles.subline}>
                    {entry.summary === "" ? entry.path : entry.summary}
                  </span>
                </td>
                <td>{entry.category === "" ? "—" : entry.category}</td>
                <td>
                  <Badge
                    tone={KNOWLEDGE_STATUS_TONE[entry.status]}
                    text={KNOWLEDGE_STATUS_LABEL[entry.status]}
                  />
                </td>
                <td>
                  {entry.embeddingStatus === "ready" ? (
                    <span className={styles.muted}>已索引</span>
                  ) : (
                    <Badge
                      tone={KNOWLEDGE_EMBEDDING_TONE[entry.embeddingStatus]}
                      text={KNOWLEDGE_EMBEDDING_LABEL[entry.embeddingStatus]}
                    />
                  )}
                </td>
                <td title={formatDateTime(entry.updatedAt)}>
                  {formatRelativeTime(entry.updatedAt, now)}
                </td>
                <td>
                  <RowActions {...actionsOf(entry)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
