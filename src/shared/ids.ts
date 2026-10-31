import { randomBytes } from "node:crypto";

/** 生成 `<prefix>_<16位hex>` 形式的主键,与库内既有 id 惯例一致 */
export function newPrefixedId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}
