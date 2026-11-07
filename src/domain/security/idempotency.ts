import type { Db } from "../../store/database.js";
import {
  findIdempotencyResource,
  saveIdempotencyResource,
} from "../../store/repositories/idempotency.js";

export interface IdempotencyService {
  /** 返回首次请求产生的资源 id;未见过该键时返回 undefined */
  find(scope: string, key: string): Promise<string | undefined>;
  /**
   * 在单事务内执行建单并登记幂等键。
   * 崩溃窗口内要么都成功,要么都不留痕;路由层据此不直接持有事务。
   */
  run<T extends { id: string }>(scope: string, key: string, work: () => Promise<T>): Promise<T>;
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
      return db.transaction(async (tx) => {
        const created = await work();
        await saveIdempotencyResource(tx, {
          scope,
          key,
          resourceId: created.id,
          createdAt: now(),
        });
        return created;
      });
    },
  };
}
