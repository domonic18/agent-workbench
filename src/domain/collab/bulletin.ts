import type {
  AcceptNotice,
  ClosureNotice,
  CompletionNotice,
  HandoffNotice,
} from "./notice.js";
import { enqueuePush } from "../../reliability/outbox.js";
import type { Db } from "../../store/database.js";
import { mdText, statusCard } from "./card.js";

/** 协作群播报载荷:uuid 透传飞书做幂等去重 */
export interface CollabBulletin {
  chatId: string;
  card: Record<string, unknown>;
  uuid: string;
  taskId: string;
}

/**
 * 协作群四条状态播报:控制台以自身应用经发件箱直发,无 @ 不唤醒任何 bot(2026-11-02 裁决)。
 * 群只承载「交接 / 接单 / 完成 / 验收」,交互细节一律走 a2a 与任务字段。
 * 2026-11-05 起以卡片(schema 2.0)渲染替代纯文本,发送侧按 payload.card 分发 interactive;
 * 卡片不展示任务/线程/消息 ID——群是人类状态投影(谁/什么/状态),机器追溯走控制台。
 */

/** ① 交接:A 发起 request/escalate;uuid 取消息 id 防重复投递 */
export function buildHandoffBulletin(notice: HandoffNotice, chatId: string): CollabBulletin {
  return {
    chatId,
    card: statusCard({
      title: `〔交接〕${notice.from.displayName} → ${notice.to.displayName}`,
      template: "blue",
      body: `**事项**:${mdText(notice.summary)}`,
    }),
    uuid: notice.msgId,
    taskId: notice.taskId,
  };
}

/** ② 接单:B ack 承接;uuid 需区别于交接,取 ack:{msgId} */
export function buildAcceptBulletin(notice: AcceptNotice, chatId: string): CollabBulletin {
  return {
    chatId,
    card: statusCard({
      title: `〔接单〕${notice.to.displayName} 已接单`,
      template: "turquoise",
      body: `**任务**:${mdText(notice.title)}`,
    }),
    uuid: `a2a:ack:${notice.msgId}`,
    taskId: notice.taskId,
  };
}

/** ③ 完成:B 下游任务 done,结论已随回执同步 */
export function buildCompletionBulletin(notice: CompletionNotice, chatId: string): CollabBulletin {
  return {
    chatId,
    card: statusCard({
      title: `〔完成〕${notice.from.displayName} 已完成`,
      template: "green",
      body: `**任务**:${mdText(notice.title)}\n**结论**:已同步给 ${notice.to.displayName}`,
    }),
    uuid: `task_done:${notice.taskId}`,
    taskId: notice.taskId,
  };
}

/** ④ 验收:根任务在「下游全部终态且回执已确认」时由系统收口 */
export function buildClosureBulletin(notice: ClosureNotice, chatId: string): CollabBulletin {
  return {
    chatId,
    card: statusCard({
      title: "〔验收〕任务已闭环",
      template: "indigo",
      body: `**任务**:${mdText(notice.title)}`,
    }),
    uuid: `task_closed:${notice.taskId}`,
    taskId: notice.taskId,
  };
}

/** 播报入发件箱;幂等键 = collab:{uuid},同 uuid 只保留首条。与业务写同库,await 不会放大失败面 */
export async function enqueueCollabBulletin(
  db: Db,
  bulletin: CollabBulletin,
  now?: number,
): Promise<void> {
  await enqueuePush(db, {
    idempotencyKey: `collab:${bulletin.uuid}`,
    kind: "collab_bulletin",
    taskId: bulletin.taskId,
    chatId: bulletin.chatId,
    card: bulletin.card,
    uuid: bulletin.uuid,
    ...(now === undefined ? {} : { now }),
  });
}
