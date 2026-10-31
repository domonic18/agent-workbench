/**
 * Teleport bot 资源(05 §4/§7):每 Agent 一个 bot,每任务一个 trait。
 * `aw_ticket_id` 与 `aw_task_id` 一起下发,证书扩展与 `session.start.user_traits`
 * 都能看到;控制台 `capability.ticket_id` 存同一个值,两边同源但不同事务域,按它对账。
 */

const BOT_NAME = /^[a-z][a-z0-9-]{0,62}$/;
const TRAIT_VALUE = /^[A-Za-z0-9._:-]{1,64}$/;
const DURATION = /^[1-9]\d{0,5}(s|m|h)$/;

export interface BotManifestInput {
  botName: string;
  role: string;
  maxSessionTtl: string;
  taskId: string;
  ticketId: string;
}

function assertMatch(value: string, pattern: RegExp, field: string): void {
  if (!pattern.test(value)) {
    throw new Error(`${field} 不合法: ${value.slice(0, 32)}`);
  }
}

/**
 * traits 直接拼进 YAML,因此 task / ticket 走白名单字符集,
 * 不用「转义 YAML」这种容易漏的口子。
 */
export function renderBotManifest(input: BotManifestInput): string {
  assertMatch(input.botName, BOT_NAME, "botName");
  assertMatch(input.taskId, TRAIT_VALUE, "taskId");
  assertMatch(input.ticketId, TRAIT_VALUE, "ticketId");
  assertMatch(input.role, BOT_NAME, "role");
  assertMatch(input.maxSessionTtl, DURATION, "maxSessionTtl");

  return `${[
    "kind: bot",
    "version: v1",
    "metadata:",
    `  name: ${input.botName}`,
    "spec:",
    `  max_session_ttl: ${input.maxSessionTtl}`,
    `  roles: [${input.role}]`,
    "  traits:",
    "    - name: aw_task_id",
    `      values: ["${input.taskId}"]`,
    "    - name: aw_ticket_id",
    `      values: ["${input.ticketId}"]`,
  ].join("\n")}\n`;
}
