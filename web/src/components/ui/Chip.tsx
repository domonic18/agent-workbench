import type { ReactNode } from "react";
import { cn } from "../../lib/utils.js";

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

export function ChipGroup({ label, options, value, onValueChange }: ChipGroupProps) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            className={cn(
              "h-control-sm px-3 border rounded-full bg-surface text-sm font-semibold whitespace-nowrap text-text-secondary transition-colors",
              "hover:border-accent-border hover:text-accent",
              active && "border-accent bg-accent text-on-accent hover:border-accent hover:bg-accent hover:text-on-accent",
              "max-md:min-h-touch",
            )}
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
