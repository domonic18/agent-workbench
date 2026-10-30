import {
  A2A_INTENTS,
  A2A_PROTOCOL_VERSION,
  ENVELOPE_LIMITS,
  type A2AIntent,
} from "./constants.js";

export interface A2AEnvelope {
  v: string;
  task_id: string;
  round: number;
  from: string;
  to: string;
  intent: A2AIntent;
  summary: string;
  expect: string;
  deadline?: string;
  refs?: string[];
  auth?: { ticket_id: string };
}

export interface EnvelopeIssue {
  field: string;
  reason: "missing" | "invalid";
  message: string;
}

export type EnvelopeValidation =
  | { ok: true; envelope: A2AEnvelope }
  | { ok: false; issues: EnvelopeIssue[] };

const DEADLINE_REQUIRED: readonly A2AIntent[] = ["request", "reply", "escalate"];
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 信封校验(01 §5)。缺失与非法一次报全,调用方不需要「补一个再试一次」。
 * 只校验形状;`task_id` 存在性、`from` / `to` 是否已注册由服务层查库判定。
 */
export function validateEnvelope(input: unknown): EnvelopeValidation {
  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [{ field: "$", reason: "invalid", message: "信封必须是 JSON 对象" }],
    };
  }

  const issues: EnvelopeIssue[] = [];
  const missing = (field: string): void => {
    issues.push({ field, reason: "missing", message: `${field} 必填` });
  };
  const invalid = (field: string, message: string): void => {
    issues.push({ field, reason: "invalid", message });
  };

  const readText = (field: string, maxLength: number): string => {
    const raw = input[field];
    if (raw === undefined || raw === null) {
      missing(field);
      return "";
    }
    if (typeof raw !== "string") {
      invalid(field, `${field} 必须是字符串`);
      return "";
    }
    if (raw.trim() === "") {
      missing(field);
      return "";
    }
    if (raw.length > maxLength) {
      invalid(field, `${field} 超过 ${maxLength} 字符`);
      return "";
    }
    return raw;
  };

  const v = readText("v", 16);
  if (v !== "" && v !== A2A_PROTOCOL_VERSION) {
    invalid("v", `不支持的协议版本 ${v},当前只接受 ${A2A_PROTOCOL_VERSION}`);
  }

  const taskId = readText("task_id", ENVELOPE_LIMITS.identifier);
  const from = readText("from", ENVELOPE_LIMITS.identifier);
  const to = readText("to", ENVELOPE_LIMITS.identifier);
  const summary = readText("summary", ENVELOPE_LIMITS.summary);
  const expect = readText("expect", ENVELOPE_LIMITS.expect);

  let round = 0;
  const rawRound = input.round;
  if (rawRound === undefined || rawRound === null) {
    missing("round");
  } else if (typeof rawRound !== "number" || !Number.isInteger(rawRound) || rawRound < 1) {
    invalid("round", "round 必须是 ≥ 1 的整数");
  } else {
    round = rawRound;
  }

  let intent: A2AIntent | undefined;
  const rawIntent = input.intent;
  if (rawIntent === undefined || rawIntent === null || rawIntent === "") {
    missing("intent");
  } else if (
    typeof rawIntent !== "string" ||
    !(A2A_INTENTS as readonly string[]).includes(rawIntent)
  ) {
    invalid("intent", `intent 必须是 ${A2A_INTENTS.join(" / ")} 之一`);
  } else {
    intent = rawIntent as A2AIntent;
  }

  const rawDeadline = input.deadline;
  let deadline: string | undefined;
  if (rawDeadline === undefined || rawDeadline === null || rawDeadline === "") {
    if (intent !== undefined && DEADLINE_REQUIRED.includes(intent)) {
      missing("deadline");
    }
  } else if (typeof rawDeadline !== "string" || !RFC3339.test(rawDeadline)) {
    invalid("deadline", "deadline 必须是 RFC3339 UTC 时间,如 2026-10-30T12:00:00Z");
  } else if (Number.isNaN(Date.parse(rawDeadline))) {
    invalid("deadline", "deadline 不是合法时间");
  } else {
    deadline = rawDeadline;
  }

  const rawRefs = input.refs;
  let refs: string[] | undefined;
  if (rawRefs !== undefined && rawRefs !== null) {
    if (!Array.isArray(rawRefs) || rawRefs.length > ENVELOPE_LIMITS.refs) {
      invalid("refs", `refs 必须是不超过 ${ENVELOPE_LIMITS.refs} 项的数组`);
    } else if (rawRefs.some((item) => typeof item !== "string" || item.trim() === "")) {
      invalid("refs", "refs 每一项都必须是非空字符串");
    } else {
      refs = rawRefs as string[];
    }
  }

  const rawAuth = input.auth;
  let auth: { ticket_id: string } | undefined;
  if (rawAuth !== undefined && rawAuth !== null) {
    if (!isRecord(rawAuth)) {
      invalid("auth", "auth 必须是对象");
    } else {
      const ticketId = rawAuth.ticket_id;
      if (typeof ticketId !== "string" || ticketId.trim() === "") {
        invalid("auth.ticket_id", "auth.ticket_id 必填");
      } else {
        auth = { ticket_id: ticketId };
      }
    }
  }

  if (issues.length > 0 || intent === undefined) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    envelope: {
      v,
      task_id: taskId,
      round,
      from,
      to,
      intent,
      summary,
      expect,
      ...(deadline === undefined ? {} : { deadline }),
      ...(refs === undefined ? {} : { refs }),
      ...(auth === undefined ? {} : { auth }),
    },
  };
}
