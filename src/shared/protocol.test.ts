import { describe, expect, it } from "vitest";
import { validateEnvelope } from "./protocol.js";

const VALID = {
  v: "1.0",
  task_id: "tsk_01J0000000000000000000000",
  round: 3,
  from: "agent:workbuddy",
  to: "agent:codex",
  intent: "request",
  summary: "需要补一份接口契约",
  expect: "一份 OpenAPI 片段",
  deadline: "2026-10-30T12:00:00Z",
  refs: ["kb_01J0000000000000000000000"],
  auth: { ticket_id: "cap_01J0000000000000000000000" },
};

describe("validateEnvelope", () => {
  it("合法信封原样通过", () => {
    const result = validateEnvelope(VALID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.intent).toBe("request");
      expect(result.envelope.refs).toEqual(["kb_01J0000000000000000000000"]);
    }
  });

  it("缺多项时一次返回全部缺失项", () => {
    const result = validateEnvelope({ v: "1.0", intent: "request", round: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const missingFields = result.issues
        .filter((issue) => issue.reason === "missing")
        .map((issue) => issue.field)
        .sort();
      expect(missingFields).toEqual(["deadline", "expect", "from", "summary", "task_id", "to"]);
    }
  });

  it("未知协议版本拒收", () => {
    const result = validateEnvelope({ ...VALID, v: "2.0" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ field: "v", reason: "invalid" }),
      );
    }
  });

  it("非法 intent 拒收", () => {
    const result = validateEnvelope({ ...VALID, intent: "order" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.field)).toEqual(["intent"]);
    }
  });

  it("summary 超长拒收", () => {
    const result = validateEnvelope({ ...VALID, summary: "补".repeat(201) });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ field: "summary", reason: "invalid" }),
      );
    }
  });

  it("notify 免 deadline,request 必填", () => {
    const withoutDeadline = { ...VALID, deadline: undefined };

    expect(validateEnvelope({ ...withoutDeadline, intent: "notify" }).ok).toBe(true);

    const request = validateEnvelope({ ...withoutDeadline, intent: "request" });
    expect(request.ok).toBe(false);
    if (!request.ok) {
      expect(request.issues.map((issue) => issue.field)).toEqual(["deadline"]);
    }
  });

  it("deadline 必须带时区", () => {
    const result = validateEnvelope({ ...VALID, deadline: "2026-10-30 12:00:00" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.field)).toEqual(["deadline"]);
    }
  });

  it("非对象输入直接拒收", () => {
    expect(validateEnvelope("v=1.0").ok).toBe(false);
    expect(validateEnvelope(null).ok).toBe(false);
    expect(validateEnvelope([]).ok).toBe(false);
  });
});
