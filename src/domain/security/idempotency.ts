import type { Db } from "../../store/database.js";
import {
  findIdempotencyResource,
  saveIdempotencyResource,
} from "../../store/repositories/idempotency.js";

export interface IdempotencyService {
  /** 返回首次请求产生的资源 id;未见过该键时返回 undefined */
  find(scope: string, key: string): string | undefined;
  /**
   * 在单事务内执行建单并登记幂等键。
   * 崩溃窗口内要么都成功,要么都不留痕;路由层据此不直接持有事务。
   */
  run<T extends { id: string }>(scope: string, key: string, work: () => T): T;
}

export interface IdempotencyDeps {
  db: Db;
  now?: () => number;
}

export function createIdempotencyService(deps: IdempotencyDeps): IdempotencyService {
  const { db } = deps;
  const now = deps.now ?? Date.now;

  return {
    find: (scope, key) => findIdempotencyResource(db, scope, key),
    run(scope, key, work) {
      return db.transaction(() => {
        const created = work();
        saveIdempotencyResource(db, {
          scope,
          key,
          resourceId: created.id,
          createdAt: now(),
        });
        return created;
      })();
    },
  };
}
