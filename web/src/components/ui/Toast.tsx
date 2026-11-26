import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils.js";

export type ToastTone = "info" | "positive" | "danger";

interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

interface ToastContextValue {
  push: (text: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_CLASS: Record<ToastTone, string> = {
  info: "border-accent-border bg-accent-soft text-accent",
  positive: "border-positive-border bg-positive-soft text-positive",
  danger: "border-danger-border bg-danger-soft text-danger",
};

const AUTO_DISMISS_MS = 3600;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((text: string, tone: ToastTone = "info") => {
    const id = nextId.current;
    nextId.current += 1;
    setItems((current) => [...current, { id, text, tone }]);
    setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-5 bottom-5 z-80 flex flex-col gap-2" role="status" aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "flex items-center gap-2 min-w-toast-min max-w-toast-max px-4 py-3 border rounded-md bg-surface shadow-md text-sm animate-rise",
              TONE_CLASS[item.tone],
            )}
          >
            {item.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (value === null) {
    throw new Error("useToast 必须在 ToastProvider 内使用");
  }
  return value;
}
