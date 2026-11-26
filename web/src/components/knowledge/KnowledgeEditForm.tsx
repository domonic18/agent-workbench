import { KNOWLEDGE_LIMITS } from "../../api/knowledge.js";
import { Button } from "../ui/Button.js";
import { Field, Input, Textarea } from "../ui/Field.js";

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
      <div className="flex flex-wrap gap-2 border-t border-border pb-4 pt-3">
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

      <div className="flex flex-col gap-3">
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
        <Field label="正文（Markdown）" htmlFor="kb-edit-content">
          <Textarea
            id="kb-edit-content"
            className="min-h-[280px] font-mono text-sm leading-[1.6]"
            value={values.content}
            rows={16}
            onChange={(event) => patch({ content: event.target.value })}
          />
        </Field>
      </div>
    </>
  );
}
