import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { RealtimeStatus } from "../shared/labels.js";

const CLIENT_ID_KEY = "aw_client_id";
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const FAILURES_BEFORE_DISCONNECT = 3;

interface SnapshotFrame {
  scopes: { scope: string; revision: number }[];
  at: number;
}

/** 1s → 2s → 4s → 8s … 上限 30s(03 §5) */
export function reconnectDelay(failures: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** Math.max(failures - 1, 0), MAX_DELAY_MS);
}

export function getClientId(): string {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing !== null && CLIENT_ID_PATTERN.test(existing)) {
    return existing;
  }
  const id =
    globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
    Math.random().toString(16).slice(2).padEnd(32, "0");
  localStorage.setItem(CLIENT_ID_KEY, id);
  return id;
}

/** scope 到查询缓存的映射:收到增量就失效对应查询,由 REST 重取 */
export function queryKeyForScope(scope: string): readonly unknown[] {
  if (scope === "overview") {
    return ["overview"];
  }
  if (scope.startsWith("task:")) {
    return ["task", scope.slice("task:".length)];
  }
  return [];
}

export function useRealtimeStream(scopes: readonly string[]): RealtimeStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const scopeKey = scopes.join(",");

  useEffect(() => {
    const list = scopeKey.split(",");
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let failures = 0;

    const invalidate = (scope: string): void => {
      const key = queryKeyForScope(scope);
      if (key.length > 0) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      // 任务表的触发器同样推进 overview 水位,列表没有自己的作用域
      if (scope === "overview") {
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }
    };

    const connect = (): void => {
      if (disposed) {
        return;
      }
      const params = new URLSearchParams({ client_id: getClientId() });
      for (const scope of list) {
        params.append("scope", scope);
      }
      source = new EventSource(`/api/stream?${params.toString()}`);

      // 首帧只携带水位;数据一律回 REST 取,缺口与增量走同一条重取路径
      source.addEventListener("snapshot", (event) => {
        failures = 0;
        setStatus("live");
        const frame = JSON.parse((event as MessageEvent<string>).data) as SnapshotFrame;
        for (const entry of frame.scopes) {
          invalidate(entry.scope);
        }
      });

      source.addEventListener("delta", (event) => {
        const frame = JSON.parse((event as MessageEvent<string>).data) as {
          scope: string;
          revision: number;
        };
        invalidate(frame.scope);
      });

      // 心跳证明链路仍活,避免长时间无变更时被误判为断开
      source.addEventListener("heartbeat", () => {
        failures = 0;
        setStatus("live");
      });

      source.onerror = () => {
        source?.close();
        failures += 1;
        if (failures >= FAILURES_BEFORE_DISCONNECT) {
          setStatus("disconnected");
        }
        if (disposed) {
          return;
        }
        timer = setTimeout(connect, reconnectDelay(failures));
      };
    };

    connect();
    return () => {
      disposed = true;
      source?.close();
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [queryClient, scopeKey]);

  return status;
}

/** overview 作用域的实时连接由外壳统一持有，避免每页各开一条 SSE */
const RealtimeContext = createContext<RealtimeStatus>("connecting");

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const status = useRealtimeStream(["overview"]);
  return <RealtimeContext.Provider value={status}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeStatus(): RealtimeStatus {
  return useContext(RealtimeContext);
}
