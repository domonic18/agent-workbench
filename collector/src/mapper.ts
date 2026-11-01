import {
  INGEST_TOKEN_USAGE_KIND,
  SYNTHETIC_MODEL,
} from "../../src/shared/constants.js";

export const EVENT_KINDS = {
  userMessage: "user_message",
  assistantMessage: "assistant_message",
  thinking: "thinking",
  toolCall: "tool_call",
  toolResult: "tool_result",
  system: "system",
} as const;

export interface MappedEvent {
  kind: string;
  occurredAt: number;
  payload: Record<string, unknown>;
}

type PartialEvent = Pick<MappedEvent, "kind" | "payload">;

const TEXT_LIMIT = 2_000;
const PREVIEW_LIMIT = 300;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function nonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

export function inferProvider(model: string): string {
  if (/claude|sonnet|opus|haiku/i.test(model)) {
    return "anthropic";
  }
  if (/deepseek/i.test(model)) {
    return "deepseek";
  }
  if (/^gpt|^o[134]|openai/i.test(model)) {
    return "openai";
  }
  return "unknown";
}

function mapAssistant(message: Record<string, unknown>): PartialEvent[] {
  const model = typeof message.model === "string" ? message.model : "unknown";
  const events: PartialEvent[] = [];
  const content = Array.isArray(message.content) ? message.content : [];

  for (const item of content) {
    const block = asRecord(item);
    const type = block.type;

    if (type === "text") {
      const text = typeof block.text === "string" ? block.text : "";
      events.push({
        kind: EVENT_KINDS.assistantMessage,
        payload: { text: truncate(text, TEXT_LIMIT), length: text.length, model },
      });
      continue;
    }

    if (type === "thinking") {
      const thinking = typeof block.thinking === "string" ? block.thinking : "";
      events.push({
        kind: EVENT_KINDS.thinking,
        payload: { length: thinking.length, model },
      });
      continue;
    }

    if (type === "tool_use") {
      const name = typeof block.name === "string" ? block.name : "unknown";
      const id = typeof block.id === "string" ? block.id : "";
      let input: string;
      try {
        input = JSON.stringify(block.input ?? {});
      } catch {
        input = "";
      }
      events.push({
        kind: EVENT_KINDS.toolCall,
        payload: {
          tool_use_id: id,
          name,
          input: truncate(input, TEXT_LIMIT),
          input_length: input.length,
        },
      });
    }
  }

  return events;
}

function tokenUsageEvent(message: Record<string, unknown>, model: string): PartialEvent | null {
  if (model === SYNTHETIC_MODEL) {
    return null;
  }
  const usage = asRecord(message.usage);
  if (Object.keys(usage).length === 0) {
    return null;
  }
  return {
    kind: INGEST_TOKEN_USAGE_KIND,
    payload: {
      provider: inferProvider(model),
      model,
      input_tokens: nonNegative(usage.input_tokens),
      output_tokens: nonNegative(usage.output_tokens),
      cache_read_tokens: nonNegative(usage.cache_read_input_tokens),
      cache_creation_tokens: nonNegative(usage.cache_creation_input_tokens),
      source: "assistant_message",
    },
  };
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return "";
  }
}

function mapUserContent(message: Record<string, unknown>): PartialEvent[] {
  const events: PartialEvent[] = [];
  const content = message.content;

  if (typeof content === "string") {
    if (content.trim() !== "") {
      events.push({
        kind: EVENT_KINDS.userMessage,
        payload: { text: truncate(content, TEXT_LIMIT), length: content.length },
      });
    }
    return events;
  }

  if (!Array.isArray(content)) {
    return events;
  }

  for (const item of content) {
    const block = asRecord(item);
    if (block.type === "tool_result") {
      const text = stringifyContent(block.content);
      events.push({
        kind: EVENT_KINDS.toolResult,
        payload: {
          tool_use_id: typeof block.tool_use_id === "string" ? block.tool_use_id : "",
          is_error: block.is_error === true,
          length: text.length,
          preview: truncate(text, PREVIEW_LIMIT),
        },
      });
      continue;
    }
    if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
      events.push({
        kind: EVENT_KINDS.userMessage,
        payload: { text: truncate(block.text, TEXT_LIMIT), length: block.text.length },
      });
    }
  }

  return events;
}

/** 一行 JSONL → 0~N 个事件;解析不了的行静默跳过,由 daemon 计数 */
export function mapLine(line: string, fallbackAt: number): MappedEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  const record = asRecord(parsed);
  const type = record.type;
  if (record.isMeta === true) {
    return [];
  }
  const timestamp = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN;
  const occurredAt = Number.isFinite(timestamp) ? timestamp : fallbackAt;
  const message = asRecord(record.message);

  let events: PartialEvent[] = [];
  if (type === "assistant") {
    events = mapAssistant(message);
    const model = typeof message.model === "string" ? message.model : "unknown";
    const usage = tokenUsageEvent(message, model);
    if (usage !== null) {
      events.push(usage);
    }
  } else if (type === "user") {
    events = mapUserContent(message);
  } else if (type === "system" && typeof record.subtype === "string") {
    events = [{ kind: EVENT_KINDS.system, payload: { subtype: record.subtype } }];
  }

  if (record.isSidechain === true) {
    for (const event of events) {
      event.payload.sidechain = true;
    }
  }
  return events.map((event) => ({ ...event, occurredAt }));
}
