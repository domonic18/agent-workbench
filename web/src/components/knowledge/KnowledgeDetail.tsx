import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ApiError } from "../../api/client.js";
import {
  adoptKnowledgeEntry,
  archiveKnowledgeEntry,
  fetchKnowledgeEntry,
  updateKnowledgeEntry,
  type KnowledgeEntryDto,
} from "../../api/knowledge.js";
import { formatDateTime } from "../../shared/format.js";
import {
  KNOWLEDGE_EMBEDDING_LABEL,
  KNOWLEDGE_EMBEDDING_TONE,
  KNOWLEDGE_STATUS_LABEL,
  KNOWLEDGE_STATUS_TONE,
} from "../../shared/labels.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { Dialog } from "../ui/Dialog.js";
import { KnowledgeEditForm, type KnowledgeEditValues } from "./KnowledgeEditForm.js";
import markdownStyles from "./knowledge-markdown.module.css";
import styles from "./knowledge-detail.module.css";

export interface KnowledgeDetailProps {
  entryId: string;
  onClose: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.metaRow}>
      <dt className={styles.metaLabel}>{label}</dt>
      <dd className={styles.metaValue}>{children}</dd>
    </div>
  );
}

export function KnowledgeDetail({ entryId, onClose }: KnowledgeDetailProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [form, setForm] = useState<KnowledgeEditValues>({
    title: "",
    summary: "",
    category: "",
    content: "",
  });

  const detail = useQuery({
    queryKey: ["knowledge", "detail", entryId],
    queryFn: () => fetchKnowledgeEntry(entryId),
    retry: (count, caught) =>
      !(caught instanceof ApiError && caught.status === 401) && count < 2,
  });

  const entry = detail.data?.entry;
  const content = detail.data?.content ?? "";

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ["knowledge"] });
  }

  const save = useMutation({
    mutationFn: (input: KnowledgeEditValues) =>
      updateKnowledgeEntry(entryId, {
        content: input.content,
        title: input.title.trim(),
        summary: input.summary,
        category: input.category.trim(),
      }),
    onSuccess: async () => {
      setEditing(false);
      setActionError(null);
      await refresh();
    },
    onError: (caught) => setActionError(errorMessage(caught, "保存失败")),
  });

  const adopt = useMutation({
    mutationFn: () => adoptKnowledgeEntry(entryId),
    onSuccess: async () => {
      setActionError(null);
      await refresh();
    },
    onError: (caught) => setActionError(errorMessage(caught, "采纳失败")),
  });

  const archive = useMutation({
    mutationFn: () => archiveKnowledgeEntry(entryId),
    onSuccess: async () => {
      setActionError(null);
      await refresh();
      onClose();
    },
    onError: (caught) => {
      setActionError(errorMessage(caught, "丢弃失败"));
      setConfirmArchive(false);
    },
  });

  function startEditing(target: KnowledgeEntryDto, body: string): void {
    setForm({
      title: target.title,
      summary: target.summary,
      category: target.category,
      content: body,
    });
    setEditing(true);
    setActionError(null);
    setConfirmArchive(false);
  }

  const busy = save.isPending || adopt.isPending || archive.isPending;

  return (
    <Dialog
      variant="drawer"
      ariaLabel="知识详情"
      onClose={onClose}
      title={entry === undefined ? entryId : entry.title}
      headerExtra={
        entry === undefined ? null : (
          <>
            <Badge
              tone={KNOWLEDGE_STATUS_TONE[entry.status]}
              text={KNOWLEDGE_STATUS_LABEL[entry.status]}
            />
            <Badge
              tone={KNOWLEDGE_EMBEDDING_TONE[entry.embeddingStatus]}
              text={KNOWLEDGE_EMBEDDING_LABEL[entry.embeddingStatus]}
            />
          </>
        )
      }
    >
      {detail.isPending ? <p className={styles.loading}>加载中…</p> : null}

      {detail.isError ? (
        <div className={styles.errorBox} role="alert">
          <span>{errorMessage(detail.error, "知识详情加载失败")}</span>
          <Button size="sm" variant="secondary" onClick={() => void detail.refetch()}>
            重试
          </Button>
        </div>
      ) : null}

      {actionError === null ? null : (
        <div className={styles.errorBox} role="alert">
          <span>{actionError}</span>
        </div>
      )}

      {entry === undefined || detail.isError ? null : (
        <>
          <dl className={styles.meta}>
            <MetaRow label="路径">
              <span className={styles.path}>{entry.path}</span>
            </MetaRow>
            <MetaRow label="分类">{entry.category === "" ? "未分类" : entry.category}</MetaRow>
            <MetaRow label="来源任务">
              {entry.sourceTaskId === null ? "—" : entry.sourceTaskId}
            </MetaRow>
            <MetaRow label="来源 Agent">
              {entry.sourceAgentId === null ? "—" : entry.sourceAgentId}
            </MetaRow>
            <MetaRow label="创建时间">{formatDateTime(entry.createdAt)}</MetaRow>
            <MetaRow label="更新时间">{formatDateTime(entry.updatedAt)}</MetaRow>
          </dl>

          {entry.protected ? (
            <p className={styles.protectedNote}>
              index.md / log.md 由系统维护，控制台只读。
            </p>
          ) : null}

          {editing ? (
            <KnowledgeEditForm
              values={form}
              busy={save.isPending}
              onChange={setForm}
              onSubmit={() => save.mutate(form)}
              onCancel={() => {
                setEditing(false);
                setActionError(null);
              }}
            />
          ) : (
            <>
              <div className={styles.toolbar}>
                {entry.protected ? null : (
                  <Button variant="secondary" onClick={() => startEditing(entry, content)}>
                    编辑
                  </Button>
                )}
                {entry.status === "candidate" ? (
                  <>
                    <Button
                      variant="primary"
                      disabled={busy}
                      loading={adopt.isPending}
                      onClick={() => adopt.mutate()}
                    >
                      {adopt.isPending ? "采纳中…" : "采纳"}
                    </Button>
                    <Button
                      variant={confirmArchive ? "danger" : "secondary"}
                      disabled={busy}
                      onClick={() => {
                        if (!confirmArchive) {
                          setConfirmArchive(true);
                          return;
                        }
                        archive.mutate();
                      }}
                    >
                      {archive.isPending ? "丢弃中…" : confirmArchive ? "确认丢弃" : "丢弃"}
                    </Button>
                    {confirmArchive ? (
                      <Button variant="secondary" onClick={() => setConfirmArchive(false)}>
                        取消
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>

              <div className={markdownStyles.markdown}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
