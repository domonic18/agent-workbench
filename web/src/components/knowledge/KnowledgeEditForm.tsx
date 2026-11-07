import { KNOWLEDGE_LIMITS } from "../../api/knowledge.js";
import { Button } from "../ui/Button.js";
import { Field, Input, Textarea } from "../ui/Field.js";
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
        <Button
          variant="primary"
          disabled={busy || values.title.trim() === ""}
          loading={busy}
          onClick={onSubmit}
        >
          {busy ? "保存中…" : "保存"}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          取消
        </Button>
      </div>

      <div className={styles.editForm}>
        <Field label="标题" htmlFor="kb-edit-title">
          <Input
            id="kb-edit-title"
            value={values.title}
            maxLength={KNOWLEDGE_LIMITS.title}
            onChange={(event) => patch({ title: event.target.value })}
          />
        </Field>
        <Field label="摘要" htmlFor="kb-edit-summary">
          <Input
            id="kb-edit-summary"
            value={values.summary}
            maxLength={KNOWLEDGE_LIMITS.summary}
            onChange={(event) => patch({ summary: event.target.value })}
          />
        </Field>
        <Field label="分类" htmlFor="kb-edit-category">
          <Input
            id="kb-edit-category"
            value={values.category}
            maxLength={KNOWLEDGE_LIMITS.category}
            onChange={(event) => patch({ category: event.target.value })}
          />
        </Field>
        <Field label="正文（Markdown）" htmlFor="kb-edit-content" hint="保存会写入 Markdown 文件并重建该条索引。">
          <Textarea
            id="kb-edit-content"
            className={styles.contentInput}
            value={values.content}
            rows={16}
            onChange={(event) => patch({ content: event.target.value })}
          />
        </Field>
      </div>
    </>
  );
}
