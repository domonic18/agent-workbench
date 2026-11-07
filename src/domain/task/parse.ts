import { TASK_LIMITS, type TaskStatus } from "../../shared/constants.js";
import { TaskError } from "./errors.js";

/** output 是索引而非正文:知识条目 id 或 http(s) 链接 */
const OUTPUT_PATTERN = /^(kb_[A-Za-z0-9]+|https?:\/\/\S+)$/;

export function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new TaskError("VALIDATION_FAILED", `${field} 必须是字符串`);
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new TaskError("VALIDATION_FAILED", `${field} 不能为空`);
  }
  if (trimmed.length > max) {
    throw new TaskError("VALIDATION_FAILED", `${field} 超过 ${max} 字符`);
  }
  return trimmed;
}

export function parseOutput(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const text = requireText(value, "output", TASK_LIMITS.output);
  if (!OUTPUT_PATTERN.test(text)) {
    throw new TaskError(
      "VALIDATION_FAILED",
      "output 须为知识条目 id(kb_*)或 http(s) 链接",
    );
  }
  return text;
}

export function parseDeadline(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TaskError("VALIDATION_FAILED", "deadlineAt 须为正整数毫秒时间戳");
  }
  return value;
}

/** 状态跃迁要落的领域事件;null 表示该跃迁不单独落事件 */
export function eventsForStatusChange(to: TaskStatus): "blocked" | "resumed" | "completed" | null {
  if (to === "blocked") {
    return "blocked";
  }
  if (to === "running") {
    return "resumed";
  }
  if (to === "done") {
    return "completed";
  }
  return null;
}
