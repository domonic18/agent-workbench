import type { ReactNode } from "react";
import styles from "./controls.module.css";

export interface ChipOption {
  key: string;
  label: ReactNode;
}

export interface ChipGroupProps {
  /** 分组无障碍名，如「状态筛选」 */
  label: string;
  options: ChipOption[];
  /** 选中的 key；空串表示「全部」 */
  value: string;
  onValueChange: (key: string) => void;
}

/** 状态筛选用的胶囊按钮组；是可切换按钮组，不是页签 */
export function ChipGroup({ label, options, value, onValueChange }: ChipGroupProps) {
  return (
    <div className={styles.chipGroup} role="group" aria-label={label}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            className={`${styles.chip} ${active ? styles.chipActive : ""}`}
            aria-pressed={active}
            onClick={() => onValueChange(option.key)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
