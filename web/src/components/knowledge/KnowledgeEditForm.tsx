import { KNOWLEDGE_LIMITS } from "../../api/knowledge.js";
import styles from "./knowledge-detail.module.css";

export interface KnowledgeEditValues {
  title: string;
  summary: string;
  category: string;
  content: string;
}

export interface KnowledgeEditFormProps {
  values: KnowledgeEditValues;
  busy: boolean;
  onChange: (values: KnowledgeEditValues) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function KnowledgeEditForm({
  values,
  busy,
  onChange,
  onSubmit,
  onCancel,
}: KnowledgeEditFormProps) {
  function patch(part: Partial<KnowledgeEditValues>): void {
    onChange({ ...values, ...part });
  }

  return (
    <>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.primary}
          disabled={busy || values.title.trim() === ""}
          onClick={onSubmit}
        >
          {busy ? "保存中…" : "保存"}
        </button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={onCancel}>
          取消
        </button>
      </div>

      <div className={styles.editForm}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>标题</span>
          <input
            className={styles.input}
            value={values.title}
            maxLength={KNOWLEDGE_LIMITS.title}
            onChange={(event) => patch({ title: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>摘要</span>
          <input
            className={styles.input}
            value={values.summary}
            maxLength={KNOWLEDGE_LIMITS.summary}
            onChange={(event) => patch({ summary: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>分类</span>
          <input
            className={styles.input}
            value={values.category}
            maxLength={KNOWLEDGE_LIMITS.category}
            onChange={(event) => patch({ category: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>正文（Markdown）</span>
          <textarea
            className={styles.textarea}
            value={values.content}
            rows={16}
            onChange={(event) => patch({ content: event.target.value })}
          />
        </label>
        <p className={styles.editHint}>保存会写入 Markdown 文件并重建该条索引。</p>
      </div>
    </>
  );
}
