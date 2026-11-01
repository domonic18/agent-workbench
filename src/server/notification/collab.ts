import type {
  CollabAgentRef,
  CompletionNotice,
  HandoffNotice,
} from "../../domain/collab/notice.js";
import type { CollabNotify } from "../../shared/collab.js";

/** 对方 bot 未注册 open_id 时退化为纯文本名字,群消息照常可读 */
function mention(ref: CollabAgentRef): string {
  return ref.botOpenId === null
    ? ref.displayName
    : `<at user_id="${ref.botOpenId}">${ref.displayName}</at>`;
}

/** 交接通知:由发起方 A 的 bot 在协作群 @ 收件方 B;uuid 取消息 id 防重复投递 */
export function buildHandoffNotify(notice: HandoffNotice, chatId: string): CollabNotify {
  return {
    chat_id: chatId,
    text: `${mention(notice.to)} 新任务交接:${notice.summary}\n任务 ${notice.taskId} · 线程 ${notice.threadId}`,
    uuid: notice.msgId,
  };
}

/** 完成通知:由完成方 B 的 bot 在协作群 @ 发起方 A */
export function buildCompletionNotify(notice: CompletionNotice, chatId: string): CollabNotify {
  return {
    chat_id: chatId,
    text: `${mention(notice.to)} 任务完成:${notice.title}(${notice.taskId})`,
    uuid: `task_done:${notice.taskId}`,
  };
}
