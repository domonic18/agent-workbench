import { CapabilityError } from "./errors.js";

const BOT_NAME = /^[a-z][a-z0-9-]{0,62}$/;

/**
 * Agent 身份 → Teleport bot 名。M2.5 身份域落地后改为读登记表里的既有映射;
 * 在那之前用确定性收敛规则,保证同一 subject 每次得到同一个 bot。
 */
export function deriveBotName(subject: string): string {
  const slug = subject
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  const name = `aw-${slug}`.slice(0, 63).replace(/-+$/g, "");
  if (!BOT_NAME.test(name)) {
    throw new CapabilityError("VALIDATION_FAILED", `subject 无法映射为合法的 Teleport bot 名: ${subject}`);
  }
  return name;
}
