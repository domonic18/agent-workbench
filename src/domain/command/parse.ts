/**
 * 控制台指令只认显式登记的英文斜杠命令(01 §8.1):
 * 未命中即「不支持」,不猜意图;缺参一次报全部缺失项。
 */

export type ParsedCommand =
  | { kind: "task.list" }
  | { kind: "task.show"; taskId: string }
  | { kind: "approve"; taskId: string }
  | { kind: "reject"; taskId: string; reason: string | undefined }
  | { kind: "resend"; taskId: string };

export type ParseFailure =
  | { reason: "empty" }
  | { reason: "unsupported"; received: string }
  | { reason: "missing"; missing: readonly string[]; usage: string }
  | { reason: "invalid"; detail: string; usage: string };

export type ParseResult = { ok: true; command: ParsedCommand } | ({ ok: false } & ParseFailure);

export const SUPPORTED_HINT =
  "可用指令：/task list、/task <taskId>、/approve <taskId>、/reject <taskId> [原因]、/resend <taskId>";

const TASK_ID = /^[A-Za-z0-9._:-]{1,64}$/;

function invalidTaskId(taskId: string): ParseFailure {
  return { reason: "invalid", detail: `taskId 不合法：${taskId.slice(0, 32)}`, usage: SUPPORTED_HINT };
}

export function parseCommand(text: string | undefined): ParseResult {
  const trimmed = text?.trim() ?? "";
  if (trimmed === "") {
    return { ok: false, reason: "empty" };
  }
  if (!trimmed.startsWith("/")) {
    return { ok: false, reason: "unsupported", received: trimmed };
  }

  const [name = "", ...args] = trimmed.slice(1).split(/\s+/);
  const command = name.toLowerCase();

  if (command === "task") {
    const [sub = ""] = args;
    if (sub === "") {
      return {
        ok: false,
        reason: "missing",
        missing: ["子命令"],
        usage: "/task list | /task <taskId>",
      };
    }
    if (sub.toLowerCase() === "list") {
      if (args.length > 1) {
        return { ok: false, reason: "unsupported", received: trimmed };
      }
      return { ok: true, command: { kind: "task.list" } };
    }
    if (args.length > 1) {
      return { ok: false, reason: "invalid", detail: "多余参数", usage: "/task <taskId>" };
    }
    if (!TASK_ID.test(sub)) {
      return { ok: false, ...invalidTaskId(sub) };
    }
    return { ok: true, command: { kind: "task.show", taskId: sub } };
  }

  if (command === "approve" || command === "reject" || command === "resend") {
    const [taskId = "", ...rest] = args;
    if (taskId === "") {
      return {
        ok: false,
        reason: "missing",
        missing: ["taskId"],
        usage: command === "reject" ? "/reject <taskId> [原因]" : `/${command} <taskId>`,
      };
    }
    if (!TASK_ID.test(taskId)) {
      return { ok: false, ...invalidTaskId(taskId) };
    }
    if (command === "reject") {
      const reason = rest.join(" ").trim();
      return {
        ok: true,
        command: { kind: "reject", taskId, reason: reason === "" ? undefined : reason },
      };
    }
    if (rest.length > 0) {
      return { ok: false, reason: "invalid", detail: "多余参数", usage: `/${command} <taskId>` };
    }
    return {
      ok: true,
      command: command === "approve" ? { kind: "approve", taskId } : { kind: "resend", taskId },
    };
  }

  return { ok: false, reason: "unsupported", received: trimmed };
}
