import { useState, type ReactNode } from "react";
import { cn } from "../../lib/utils.js";

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
      <div className="flex gap-1 w-fit p-1 border border-border rounded-md bg-surface-2" role="tablist">
        {items.map((item) => {
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={cn(
                "px-4 py-2 border-none rounded-sm bg-transparent text-text-secondary text-xs font-medium whitespace-nowrap transition-colors hover:text-foreground",
                isActive && "bg-surface text-foreground font-semibold shadow-xs",
              )}
              onClick={() => select(item.key)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div className="pt-4" role="tabpanel">
        {current?.content ?? null}
      </div>
    </div>
  );
}
