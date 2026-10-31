import type { CommandOutcome } from "../../shared/constants.js";
import type { TaskSummary } from "../../store/repositories/task.js";
import { parseCommand, SUPPORTED_HINT, type ParseFailure } from "./parse.js";

export interface CommandResult {
  outcome: CommandOutcome;
  /** 审计用的规范命令名;未识别时为 null */
  command: string | null;
  reply: string;
}

export interface CommandDeps {
  listTasks(limit: number): readonly TaskSummary[];
  findTask(id: string): TaskSummary | undefined;
}

/** 回执走飞书单条文本,列表截断到 10 条,避免刷屏 */
const LIST_LIMIT = 10;

function formatTime(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function taskLine(task: TaskSummary): string {
  const deadline = task.deadlineAt === null ? "未设" : formatTime(task.deadlineAt);
  return `- ${task.id} · ${task.title} · ${task.stage}/${task.status} · 承接 ${task.assignee} · 截止 ${deadline}`;
}

function taskDetail(task: TaskSummary): string {
  const deadline = task.deadlineAt === null ? "未设" : formatTime(task.deadlineAt);
  return [
    `任务 ${task.id}`,
    `标题：${task.title}`,
    `阶段 / 状态：${task.stage} / ${task.status}`,
    `下发 → 承接：${task.assigner} → ${task.assignee}`,
    `项目：${task.project}`,
    `截止：${deadline}`,
    `token：${task.totalTokens}`,
  ].join("\n");
}

function notFound(taskId: string): CommandResult {
  return { outcome: "handled", command: null, reply: `未找到任务 ${taskId}。` };
}

function failure(failure: ParseFailure): CommandResult {
  const reply = (() => {
    switch (failure.reason) {
      case "empty":
        return `不支持：未识别到文本指令。${SUPPORTED_HINT}`;
      case "unsupported":
        return `不支持该指令。${SUPPORTED_HINT}`;
      case "missing":
        return `缺少参数：${failure.missing.join("、")}。用法：${failure.usage}`;
      case "invalid":
        return `参数不正确：${failure.detail}。用法：${failure.usage}`;
    }
  })();
  return {
    outcome: failure.reason === "unsupported" || failure.reason === "empty" ? "unsupported" : "invalid",
    command: null,
    reply,
  };
}

/**
 * 已登记指令只做查询与「记录待接入」回执,永不建单(01 §8.1)。
 * 审批与重发的数据面在 M2 / M2.5,当前只校验目标任务并如实说明。
 */
export function executeCommand(deps: CommandDeps, text: string | undefined): CommandResult {
  const parsed = parseCommand(text);
  if (!parsed.ok) {
    return failure(parsed);
  }

  const command = parsed.command;
  switch (command.kind) {
    case "task.list": {
      const tasks = deps.listTasks(LIST_LIMIT);
      if (tasks.length === 0) {
        return { outcome: "handled", command: "task.list", reply: "当前没有任务。" };
      }
      const truncated = tasks.length === LIST_LIMIT ? "（仅显示最近 10 条）" : "";
      return {
        outcome: "handled",
        command: "task.list",
        reply: `任务 ${tasks.length} 条${truncated}（按创建时间倒序）：\n${tasks.map(taskLine).join("\n")}`,
      };
    }
    case "task.show": {
      const task = deps.findTask(command.taskId);
      if (task === undefined) {
        return { ...notFound(command.taskId), command: "task.show" };
      }
      return { outcome: "handled", command: "task.show", reply: taskDetail(task) };
    }
    case "approve":
    case "reject": {
      const task = deps.findTask(command.taskId);
      if (task === undefined) {
        return { ...notFound(command.taskId), command: command.kind };
      }
      const reason =
        command.kind === "reject" && command.reason !== undefined ? `，原因：${command.reason}` : "";
      return {
        outcome: "handled",
        command: command.kind,
        reply: `审批通道尚未接入（M2 上线后可用）；已记录 /${command.kind} ${task.id}（当前 ${task.stage}/${task.status}）${reason}。`,
      };
    }
    case "resend": {
      const task = deps.findTask(command.taskId);
      if (task === undefined) {
        return { ...notFound(command.taskId), command: "resend" };
      }
      return {
        outcome: "handled",
        command: "resend",
        reply: `通知重发尚未接入（发件箱 M2 上线后可用）；已记录 /resend ${task.id}。`,
      };
    }
  }
}
