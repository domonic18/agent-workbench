/** 列表与信箱共用的 keyset 游标:`<createdAt>:<id>`,与分页排序键一一对应 */
export interface KeysetCursor {
  createdAt: number;
  id: string;
}

export function formatKeysetCursor(cursor: KeysetCursor): string {
  return `${cursor.createdAt}:${cursor.id}`;
}

export function parseKeysetCursor(cursor: string): KeysetCursor | undefined {
  const index = cursor.indexOf(":");
  if (index <= 0) {
    return undefined;
  }
  const createdAt = Number(cursor.slice(0, index));
  const id = cursor.slice(index + 1);
  if (!Number.isInteger(createdAt) || id === "") {
    return undefined;
  }
  return { createdAt, id };
}
