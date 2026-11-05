import type {
  AcceptNotice,
  ClosureNotice,
  CompletionNotice,
  HandoffNotice,
} from "./notice.js";
import { enqueuePush } from "../../reliability/outbox.js";
import type { Db } from "../../store/database.js";

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
 * 2026-11-05 起以卡片(schema 2.0)渲染替代纯文本,发送侧按 payload.card 分发 interactive。
 */

/** 动态内容打断 markdown 语法(链接/加粗/代码块),防任务标题在群里注入富文本;换行压成空格防拆行 */
function mdText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/([*_`[\]])/g, "\\$1");
}

interface BulletinView {
  title: string;
  template: string;
  body: string;
  footnote: string;
}

function bulletinCard(view: BulletinView): Record<string, unknown> {
  return {
    schema: "2.0",
    header: {
      title: { tag: "plain_text", content: view.title },
      template: view.template,
    },
    body: {
      elements: [
        { tag: "markdown", content: view.body },
        { tag: "hr" },
        { tag: "markdown", content: view.footnote },
      ],
    },
  };
}

/** ① 交接:A 发起 request/escalate;uuid 取消息 id 防重复投递 */
export function buildHandoffBulletin(notice: HandoffNotice, chatId: string): CollabBulletin {
  return {
    chatId,
    card: bulletinCard({
      title: `〔交接〕${notice.from.displayName} → ${notice.to.displayName}`,
      template: "blue",
      body: `**事项**:${mdText(notice.summary)}`,
      footnote: `任务 \`${notice.taskId}\` · 线程 \`${notice.threadId}\``,
    }),
    uuid: notice.msgId,
    taskId: notice.taskId,
  };
}

/** ② 接单:B ack 承接;uuid 需区别于交接,取 ack:{msgId} */
export function buildAcceptBulletin(notice: AcceptNotice, chatId: string): CollabBulletin {
  return {
    chatId,
    card: bulletinCard({
      title: `〔接单〕${notice.to.displayName} 已接单`,
      template: "turquoise",
      body: `**任务**:${mdText(notice.title)}`,
      footnote: `任务 \`${notice.taskId}\` · 消息 \`${notice.msgId}\``,
    }),
    uuid: `a2a:ack:${notice.msgId}`,
    taskId: notice.taskId,
  };
}

/** ③ 完成:B 下游任务 done,结论已随回执同步 */
export function buildCompletionBulletin(notice: CompletionNotice, chatId: string): CollabBulletin {
  return {
    chatId,
    card: bulletinCard({
      title: `〔完成〕${notice.from.displayName} 已完成`,
      template: "green",
      body: `**任务**:${mdText(notice.title)}\n**结论**:已同步给 ${notice.to.displayName}`,
      footnote: `任务 \`${notice.taskId}\``,
    }),
    uuid: `task_done:${notice.taskId}`,
    taskId: notice.taskId,
  };
}

/** ④ 验收:根任务在「下游全部终态且回执已确认」时由系统收口 */
export function buildClosureBulletin(notice: ClosureNotice, chatId: string): CollabBulletin {
  return {
    chatId,
    card: bulletinCard({
      title: "〔验收〕任务已闭环",
      template: "indigo",
      body: `**任务**:${mdText(notice.title)}`,
      footnote: `任务 \`${notice.taskId}\``,
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
