/**
 * SSE 连接登记(01 §7):并发按 client_id 计,单用户最多 10 个客户端。
 * 同一 client_id 的多条连接(同浏览器标签页)共享一个名额,释放按连接计。
 */
export interface StreamRegistry {
  /** 返回 false 表示新 client_id 已达上限 */
  acquire(clientId: string): boolean;
  release(clientId: string): void;
  clientCount(): number;
}

export function createStreamRegistry(maxClients: number): StreamRegistry {
  const counts = new Map<string, number>();
  return {
    acquire(clientId) {
      const current = counts.get(clientId);
      if (current === undefined) {
        if (counts.size >= maxClients) {
          return false;
        }
        counts.set(clientId, 1);
        return true;
      }
      counts.set(clientId, current + 1);
      return true;
    },
    release(clientId) {
      const current = counts.get(clientId);
      if (current === undefined) {
        return;
      }
      if (current <= 1) {
        counts.delete(clientId);
      } else {
        counts.set(clientId, current - 1);
      }
    },
    clientCount() {
      return counts.size;
    },
  };
}
