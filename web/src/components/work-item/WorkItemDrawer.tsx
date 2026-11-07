import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ApiError } from "../../api/client.js";
import { fetchAgents } from "../../api/identity.js";
import { useRealtimeStream } from "../../api/stream.js";
import { fetchWorkItem } from "../../api/work-items.js";
import { agentNameMap } from "../../shared/agent-label.js";
import {
  REALTIME_LABEL,
  REALTIME_TONE,
  WORK_ITEM_ATTENTION_LABEL,
  WORK_ITEM_STATUS_LABEL,
} from "../../shared/labels.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { Dialog } from "../ui/Dialog.js";
import { WorkItemGoalBlock, WorkItemStatusBlock } from "./WorkItemBlock.js";
import { WorkItemRelations } from "./WorkItemRelations.js";
import { WorkItemOutcome } from "./WorkItemOutcome.js";
import { WorkItemTimeline } from "./WorkItemTimeline.js";
import styles from "./work-item-drawer.module.css";

export interface WorkItemDrawerProps {
  workItemId: string;
  onClose: () => void;
  /** 从工作事项跳到任务详情 */
  onOpenTask: (taskId: string) => void;
}

/** 工作事项详情抽屉:目标与边界 / 当前状态 / 关联工作 / 结果与验证 / 永久时间线 */
export function WorkItemDrawer({ workItemId, onClose, onOpenTask }: WorkItemDrawerProps) {
  const realtime = useRealtimeStream([`work_item:${workItemId}`]);

  const detail = useQuery({
    queryKey: ["work-item", workItemId, "detail"],
    queryFn: () => fetchWorkItem(workItemId),
    retry: (count, caught) =>
      !(caught instanceof ApiError && caught.status === 401) && count < 2,
  });
  const agents = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });
  const agentNames = useMemo(() => agentNameMap(agents.data ?? []), [agents.data]);

  const item = detail.data?.workItem;

  return (
    <Dialog
      variant="drawer"
      size="lg"
      ariaLabel="工作事项详情"
      onClose={onClose}
      title={item === undefined ? workItemId : item.title}
      description={
        item === undefined
          ? "加载中…"
          : `${item.project} · ${WORK_ITEM_STATUS_LABEL[item.status]} · ${
              WORK_ITEM_ATTENTION_LABEL[item.attention]
            }`
      }
      headerExtra={<Badge tone={REALTIME_TONE[realtime]} text={REALTIME_LABEL[realtime]} />}
    >
      {detail.isPending ? <p className={styles.muted}>加载中…</p> : null}

      {detail.isError ? (
        <div className={styles.errorBox} role="alert">
          <span>
            {detail.error instanceof ApiError ? detail.error.message : "工作事项加载失败"}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void detail.refetch()}>
            重试
          </Button>
        </div>
      ) : null}

      {detail.data === undefined ? null : (
        <>
          <WorkItemGoalBlock item={detail.data.workItem} />
          <WorkItemStatusBlock
            item={detail.data.workItem}
            inbox={detail.data.inbox}
            agentNames={agentNames}
          />
          <WorkItemRelations
            tasks={detail.data.tasks}
            runs={detail.data.runs}
            inbox={detail.data.inbox}
            threads={detail.data.threads}
            agentNames={agentNames}
            onOpenTask={onOpenTask}
          />
          <WorkItemOutcome item={detail.data.workItem} />
          <WorkItemTimeline workItemId={workItemId} />
        </>
      )}
    </Dialog>
  );
}
