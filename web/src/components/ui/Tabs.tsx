import { useState, type ReactNode } from "react";
import styles from "./feedback.module.css";

export interface TabItem {
  key: string;
  label: ReactNode;
  content: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  /** 受控值；不给则内部自管 */
  value?: string;
  onValueChange?: (key: string) => void;
}

export function Tabs({ items, value, onValueChange }: TabsProps) {
  const [internal, setInternal] = useState(items[0]?.key ?? "");
  const active = value ?? internal;

  function select(key: string): void {
    if (value === undefined) {
      setInternal(key);
    }
    onValueChange?.(key);
  }

  const current = items.find((item) => item.key === active);

  return (
    <div>
      <div className={styles.tabList} role="tablist">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={item.key === active}
            className={`${styles.tab} ${item.key === active ? styles.tabActive : ""}`}
            onClick={() => select(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className={styles.tabPanel} role="tabpanel">
        {current?.content ?? null}
      </div>
    </div>
  );
}
