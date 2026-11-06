import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import styles from "./surfaces.module.css";

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
  info: styles.toastInfo ?? "",
  positive: styles.toastPositive ?? "",
  danger: styles.toastDanger ?? "",
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
      <div className={styles.toastViewport} role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`${styles.toast} ${TONE_CLASS[item.tone]}`}>
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
