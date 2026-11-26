import type { CapabilityAction, CapabilityStatus } from "@shared/constants.js";
import { ArrowRight, UserCheck } from "lucide-react";
import { CAPABILITY_ACTION_LABEL } from "../../shared/labels.js";

export interface CapabilityFlowProps {
  /** capability.subject 原文(如 agent:codex) */
  subject: string;
  /** 名册解析出的显示名;查不到时回落 subject */
  subjectName: string | null;
  action: CapabilityAction;
  target: string;
  status: CapabilityStatus;
}

const flow = "flex min-w-0 flex-1 flex-wrap items-center gap-2";
const subjectClass = "inline-flex min-w-0 items-center gap-2";
const avatar =
  "inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-avatar-bg text-sm font-bold text-avatar-text";
const subjectNameClass = "text-sm font-semibold text-foreground [overflow-wrap:anywhere]";
const arrowClass = "flex-none text-muted";
const actionBase =
  "inline-flex flex-none items-center gap-1 rounded-full border border-solid px-2 py-1 font-mono text-xs";
const glossClass = "text-2xs";
const ACTION_CLASS: Record<CapabilityAction, string> = {
  read: "bg-info-soft border-info-border text-info",
  write: "bg-warning-soft border-warning-border text-warning",
  exec: "bg-danger-soft border-danger-border text-danger",
};
const gateClass =
  "inline-flex flex-none items-center gap-1 rounded-full border border-accent-border bg-accent-soft px-2 py-1 text-xs text-accent";
const targetClass =
  "rounded-full border border-accent-border bg-accent-soft px-3 py-1 font-mono text-xs text-foreground [overflow-wrap:anywhere]";

/** 把「人工审批」画进流程:待批/签发中才出现闸门 */
function gateLabel(status: CapabilityStatus): string | null {
  if (status === "pending") {
    return "待人批准";
  }
  if (status === "issuing") {
    return "签发中";
  }
  return null;
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed === "" ? "?" : ([...trimmed][0] ?? "?").toUpperCase();
}

/** 卡片头流程条:谁能 → 对什么资源 → 做什么(→ 人工闸门 → 目标) */
export function CapabilityFlow({
  subject,
  subjectName,
  action,
  target,
  status,
}: CapabilityFlowProps) {
  const gateText = gateLabel(status);
  const name = subjectName ?? subject;
  return (
    <div className={flow}>
      <span className={subjectClass}>
        <span className={avatar} aria-hidden="true">
          {initialOf(name)}
        </span>
        <span className={subjectNameClass}>{name}</span>
      </span>
      <ArrowRight size={14} aria-hidden="true" className={arrowClass} />
      <span className={`${actionBase} ${ACTION_CLASS[action]}`}>
        {action}
        <span className={glossClass}>{CAPABILITY_ACTION_LABEL[action]}</span>
      </span>
      {gateText === null ? null : (
        <>
          <ArrowRight size={14} aria-hidden="true" className={arrowClass} />
          <span className={gateClass}>
            <UserCheck size={14} aria-hidden="true" />
            {gateText}
          </span>
        </>
      )}
      <ArrowRight size={14} aria-hidden="true" className={arrowClass} />
      <span className={targetClass}>{target}</span>
    </div>
  );
}
