import type { WorkItemDetail, WorkItemInboxLink } from "../../api/work-items.js";
import { formatDateTime, formatRelativeTime } from "../../shared/format.js";
import {
  WORK_ITEM_ATTENTION_LABEL,
  WORK_ITEM_ATTENTION_TONE,
  WORK_ITEM_STATUS_LABEL,
  WORK_ITEM_STATUS_TONE,
  WORK_ITEM_STAGE_LABEL,
} from "../../shared/labels.js";
import { agentMentionLabel } from "../../shared/agent-label.js";
import { Badge } from "../ui/Badge.js";
import { JsonBlock, KeyValueList } from "./JsonBlock.js";
import styles from "./work-item-drawer.module.css";

export interface WorkItemBlockProps {
  item: WorkItemDetail;
  /** id → 机器人名;取不到时回退 id */
  agentNames: ReadonlyMap<string, string>;
}

/** 目标与边界:人可核对「为什么可以做、做到什么程度」 */
export function WorkItemGoalBlock({ item }: { item: WorkItemDetail }) {
  return (
    <section className={styles.block} aria-label="目标与边界">
      <h3 className={styles.blockTitle}>目标与边界</h3>
      <p className={styles.blockHint}>预期结果与不可变 Mandate，来源事实，不由前端推断</p>
      <KeyValueList
        items={[
          { key: "kind", label: "事项类型", value: item.kind },
          { key: "project", label: "业务项目", value: item.project },
          {
            key: "parent",
            label: "上级事项",
            value: item.parentWorkItemId ?? "无（顶层事项）",
          },
          {
            key: "origin",
            label: "来源触发",
            value: item.originTriggerId ?? "无",
          },
          { key: "expected", label: "预期结果", value: item.expectedResult },
          {
            key: "authorization",
            label: "授权",
            value:
              item.authorization.ref === null
                ? item.authorization.kind
                : `${item.authorization.kind} · ${item.authorization.ref}`,
          },
          { key: "policy", label: "策略版本", value: item.policyVersion },
          // 进展版本是业务侧的事实推进次数,与 SSE 的作用域 revision 不是一回事
          { key: "revision", label: "进展版本", value: `第 ${item.progressRevision} 次` },
        ]}
      />
      <div className={styles.group}>
        <div className={styles.groupTitle}>作用域</div>
        <JsonBlock value={item.scope} empty="未定义作用域" />
      </div>
    </section>
  );
}

export interface WorkItemStatusBlockProps extends WorkItemBlockProps {
  inbox: readonly WorkItemInboxLink[];
}

/** 当前状态:阶段、等待对象、下一步与最近进展 */
export function WorkItemStatusBlock({ item, inbox, agentNames }: WorkItemStatusBlockProps) {
  // 等待对象由派工信箱推导:还没领走或已领未确认的行都算「在等这个机器人」
  const waiting = inbox
    .filter((row) => row.status === "pending" || row.status === "claimed")
    .map((row) => agentMentionLabel(row.targetAgentId, agentNames, row.targetAgentId));
  const waitingText =
    item.attention === "person"
      ? ["人工判断", ...waiting]
      : waiting.length === 0
        ? []
        : waiting;

  return (
    <section className={styles.block} aria-label="当前状态">
      <h3 className={styles.blockTitle}>当前状态</h3>
      <div className={styles.badges}>
        <Badge tone={WORK_ITEM_STATUS_TONE[item.status]} text={WORK_ITEM_STATUS_LABEL[item.status]} />
        <Badge tone="muted" text={WORK_ITEM_STAGE_LABEL[item.stage]} />
        <Badge
          tone={WORK_ITEM_ATTENTION_TONE[item.attention]}
          text={WORK_ITEM_ATTENTION_LABEL[item.attention]}
        />
      </div>
      <KeyValueList
        items={[
          {
            key: "next",
            label: "下一步",
            value: item.nextAction ?? "尚未给出下一步",
          },
          {
            key: "summary",
            label: "最近进展",
            value: item.latestSummary ?? "暂无进展摘要",
          },
          {
            key: "progress",
            label: "进展时间",
            value:
              item.lastProgressAt === null
                ? "尚无实质进展"
                : `${formatDateTime(item.lastProgressAt)}（${formatRelativeTime(item.lastProgressAt)}）`,
          },
          {
            key: "waiting",
            label: "等待对象",
            value:
              waitingText.length === 0 ? (
                <span className={styles.muted}>无人等待</span>
              ) : (
                <span className={styles.waiting}>{[...new Set(waitingText)].join("、")}</span>
              ),
          },
        ]}
      />
      {item.attention === "stalled" && item.lastProgressAt !== null ? (
        <p className={styles.muted}>自 {formatDateTime(item.lastProgressAt)} 起无实质进展</p>
      ) : null}
    </section>
  );
}
