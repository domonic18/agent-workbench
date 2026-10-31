import { createHash } from "node:crypto";

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "null";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

/** 审计只存参数哈希,不落原文(可能含敏感内容) */
export function hashArgs(args: Readonly<Record<string, unknown>>): string {
  return createHash("sha256").update(stableStringify(args)).digest("hex");
}
