import type { TaskEventDto } from "../../api/tasks.js";
import { TASK_EVENT_LABEL, TASK_ORIGIN_LABEL, TASK_STAGE_LABEL, TASK_STATUS_LABEL } from "../../shared/labels.js";

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    return value === "" ? null : value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function stageLabel(value: unknown): string {
  const text = asText(value);
  if (text === null) {
    return "未知阶段";
  }
  return TASK_STAGE_LABEL[text as keyof typeof TASK_STAGE_LABEL] ?? text;
}

function statusLabel(value: unknown): string {
  const text = asText(value);
  if (text === null) {
    return "未知状态";
  }
  return TASK_STATUS_LABEL[text as keyof typeof TASK_STATUS_LABEL] ?? text;
}

function move(from: unknown, to: unknown, label: (value: unknown) => string): string {
  return `${label(from)} → ${label(to)}`;
}

/** 事件正文只描述 payload,不替服务端推断未落库的语义 */
export function describeTaskEvent(event: TaskEventDto): string {
  const payload = event.payload;
  switch (event.kind) {
    case "created": {
      const origin = asText(payload.origin);
      const originLabel =
        origin === null ? "未知来源" : TASK_ORIGIN_LABEL[origin as keyof typeof TASK_ORIGIN_LABEL] ?? origin;
      const assigner = asText(payload.assigner);
      const project = asText(payload.project);
      return [
        `来源 ${originLabel}`,
        assigner === null ? null : `下发人 ${assigner}`,
        project === null ? null : `项目 ${project}`,
      ]
        .filter((part): part is string => part !== null)
        .join(" · ");
    }
    case "stage_changed":
      return `阶段 ${move(payload.from, payload.to, stageLabel)}`;
    case "blocked":
      return `状态 ${move(payload.from, payload.to, statusLabel)}`;
    case "resumed":
      return `状态 ${move(payload.from, payload.to, statusLabel)}`;
    case "completed":
      return `状态 ${move(payload.from, payload.to, statusLabel)}`;
    case "failed":
      return `状态 ${move(payload.from, payload.to, statusLabel)}`;
    case "rework": {
      const reason = asText(payload.reason);
      const base = `状态 ${move(payload.from, payload.to, statusLabel)}`;
      return reason === null ? base : `${base} · 原因：${reason}`;
    }
    case "handoff": {
      const relation = asText(payload.relation);
      const upstream =
        asText(payload.from_task_id) ?? asText(payload.upstream_task_id) ?? "未知上游任务";
      if (relation === "a2a") {
        const message = asText(payload.upstream_msg_id);
        return message === null
          ? `经 A2A 由 ${upstream} 交接`
          : `经 A2A 由 ${upstream} 交接（消息 ${message}）`;
      }
      if (relation === "continuation") {
        return `本方续接自 ${upstream}`;
      }
      return `由 ${upstream} 交接`;
    }
    default:
      return TASK_EVENT_LABEL[event.kind] ?? event.kind;
  }
}

/** 只有事件 payload 明确写了 reason 才算「有原因」,不拿状态文案顶替 */
export function latestEventReason(events: readonly TaskEventDto[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined) {
      continue;
    }
    const reason = asText(event.payload.reason);
    if (reason !== null) {
      return reason;
    }
  }
  return null;
}
