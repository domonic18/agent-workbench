import type { ReactNode } from "react";

export interface JsonBlockProps {
  value: unknown;
  /** 空值占位 */
  empty?: string;
}

/** 嵌套值压成一行,避免在抽屉里展开成树 */
function flatten(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "string") {
    return value === "" ? "—" : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function isEmptyObject(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "object" && Object.keys(value as object).length === 0)
  );
}

/**
 * 把接口给的结构化字段(scope / validation / payload)摊成可读网格。
 * 对象走键值对,数组走条目列表,标量直接给文本。
 */
export function JsonBlock({ value, empty = "无" }: JsonBlockProps) {
  if (isEmptyObject(value)) {
    return <p className="text-muted text-xs">{empty}</p>;
  }

  if (Array.isArray(value)) {
    return (
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-text-secondary">
        {value.map((entry, index) => (
          <li key={index} className="break-words">
            {flatten(entry)}
          </li>
        ))}
      </ul>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <dl className="m-0 grid max-md:grid-cols-1 grid-cols-2 gap-x-4 gap-y-2">
        {entries.map(([key, entry]) => (
          <div key={key} className="min-w-0">
            <dt className="m-0 text-xs text-muted">{key}</dt>
            <dd className="m-0 break-words text-sm text-foreground">{flatten(entry)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return <p className="m-0 break-words text-sm text-foreground">{flatten(value)}</p>;
}

export interface KeyValueListProps {
  items: { key: string; label: string; value: ReactNode }[];
}

/** 抽屉里的「标签 — 值」行 */
export function KeyValueList({ items }: KeyValueListProps) {
  return (
    <dl className="m-0 flex flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.key}
          className="grid max-md:grid-cols-[minmax(0,1fr)] max-md:gap-1 grid-cols-[88px_minmax(0,1fr)] items-baseline gap-3"
        >
          <dt className="m-0 text-xs text-muted">{item.label}</dt>
          <dd className="m-0 break-words text-sm text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
