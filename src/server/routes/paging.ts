import { LIST_LIMITS } from "../../shared/constants.js";

/**
 * 列表分页查询参数解析的收敛点:游标键集(`<数值排序键>:<id>`)、
 * limit 与 seq 游标在任务 / 工作事项 / 授权等列表路由共用,语义必须一致。
 */

/** 键集游标 `<sort>:<id>`;冒号前整数,冒号后非空字符串 id */
export function parseKeysetCursor(cursor: string): { sort: number; id: string } | undefined {
  const index = cursor.indexOf(":");
  if (index <= 0) {
    return undefined;
  }
  const sort = Number(cursor.slice(0, index));
  const id = cursor.slice(index + 1);
  if (!Number.isInteger(sort) || id === "") {
    return undefined;
  }
  return { sort, id };
}

/** 缺省返回 LIST_LIMITS.default;非法返回 undefined 由调用方回 422 */
export function parseLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return LIST_LIMITS.default;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return undefined;
  }
  const limit = Number(value);
  return limit >= 1 && limit <= LIST_LIMITS.max ? limit : undefined;
}

/** 事件游标就是 seq;缺省 0 表示取全量快照 */
export function parseSeq(value: unknown): number | undefined {
  if (value === undefined) {
    return 0;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return undefined;
  }
  return Number(value);
}
