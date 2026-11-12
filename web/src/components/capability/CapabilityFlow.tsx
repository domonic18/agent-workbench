import type { CapabilityAction, CapabilityStatus } from "@shared/constants.js";
import { ArrowRight, UserCheck } from "lucide-react";
import { CAPABILITY_ACTION_LABEL } from "../../shared/labels.js";
import styles from "./CapabilityFlow.module.css";

export interface CapabilityFlowProps {
  /** capability.subject 原文(如 agent:codex) */
  subject: string;
  /** 名册解析出的显示名;查不到时回落 subject */
  subjectName: string | null;
  action: CapabilityAction;
  target: string;
  status: CapabilityStatus;
}

const ACTION_CLASS: Record<CapabilityAction, string> = {
  read: styles.actionRead ?? "",
  write: styles.actionWrite ?? "",
  exec: styles.actionExec ?? "",
};

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
  const gate = gateLabel(status);
  const name = subjectName ?? subject;
  return (
    <div className={styles.flow}>
      <span className={styles.subject}>
        <span className={styles.avatar} aria-hidden="true">
          {initialOf(name)}
        </span>
        <span className={styles.subjectName}>{name}</span>
      </span>
      <ArrowRight size={14} aria-hidden="true" className={styles.arrow} />
      <span className={`${styles.action} ${ACTION_CLASS[action]}`}>
        {action}
        <span className={styles.gloss}>{CAPABILITY_ACTION_LABEL[action]}</span>
      </span>
      {gate === null ? null : (
        <>
          <ArrowRight size={14} aria-hidden="true" className={styles.arrow} />
          <span className={styles.gate}>
            <UserCheck size={14} aria-hidden="true" />
            {gate}
          </span>
        </>
      )}
      <ArrowRight size={14} aria-hidden="true" className={styles.arrow} />
      <span className={styles.target}>{target}</span>
    </div>
  );
}
