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

export interface WorkItemBlockProps {
  item: WorkItemDetail;
  agentNames: ReadonlyMap<string, string>;
}

export function WorkItemGoalBlock({ item }: { item: WorkItemDetail }) {
  return (
    <section className="mb-5 last:mb-0" aria-label="目标与边界">
      <h3 className="mb-1 text-md font-bold text-foreground">目标与边界</h3>
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
          { key: "revision", label: "进展版本", value: `第 ${item.progressRevision} 次` },
        ]}
      />
      <div className="mb-4 last:mb-0">
        <div className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-foreground">作用域</div>
        <JsonBlock value={item.scope} empty="未定义作用域" />
      </div>
    </section>
  );
}

export interface WorkItemStatusBlockProps extends WorkItemBlockProps {
  inbox: readonly WorkItemInboxLink[];
}

export function WorkItemStatusBlock({ item, inbox, agentNames }: WorkItemStatusBlockProps) {
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
    <section className="mb-5 last:mb-0" aria-label="当前状态">
      <h3 className="mb-1 text-md font-bold text-foreground">当前状态</h3>
      <div className="mb-3 flex flex-wrap gap-2">
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
                <span className="text-muted text-xs">无人等待</span>
              ) : (
                <span className="break-words text-sm text-text-secondary">{[...new Set(waitingText)].join("、")}</span>
              ),
          },
        ]}
      />
      {item.attention === "stalled" && item.lastProgressAt !== null ? (
        <p className="text-muted text-xs">自 {formatDateTime(item.lastProgressAt)} 起无实质进展</p>
      ) : null}
    </section>
  );
}
