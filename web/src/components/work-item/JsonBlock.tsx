import type { ReactNode } from "react";
import styles from "./work-item-drawer.module.css";

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
    return <p className={styles.muted}>{empty}</p>;
  }

  if (Array.isArray(value)) {
    return (
      <ul className={styles.jsonList}>
        {value.map((entry, index) => (
          <li key={index} className={styles.jsonItem}>
            {flatten(entry)}
          </li>
        ))}
      </ul>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <dl className={styles.jsonGrid}>
        {entries.map(([key, entry]) => (
          <div key={key} className={styles.jsonRow}>
            <dt className={styles.jsonKey}>{key}</dt>
            <dd className={styles.jsonValue}>{flatten(entry)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return <p className={styles.jsonValue}>{flatten(value)}</p>;
}

export interface KeyValueListProps {
  items: { key: string; label: string; value: ReactNode }[];
}

/** 抽屉里的「标签 — 值」行 */
export function KeyValueList({ items }: KeyValueListProps) {
  return (
    <dl className={styles.kvList}>
      {items.map((item) => (
        <div key={item.key} className={styles.kvRow}>
          <dt className={styles.kvLabel}>{item.label}</dt>
          <dd className={styles.kvValue}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
