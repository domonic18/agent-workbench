import type { Db } from "../../store/database.js";
import { currentRevision } from "../../store/repositories/revision.js";

export interface ScopeRevision {
  scope: string;
  revision: number;
}

export interface RevisionService {
  /** 按入参顺序返回各作用域当前水位;未产生过变更的作用域为 0 */
  snapshot(scopes: readonly string[]): ScopeRevision[];
}

/** 水位读取统一经域服务,SSE 与读模型都不直接访问仓储 */
export function createRevisionService({ db }: { db: Db }): RevisionService {
  return {
    snapshot(scopes) {
      return scopes.map((scope) => ({ scope, revision: currentRevision(db, scope) }));
    },
  };
}
