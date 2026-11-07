import type { A2aService } from "../a2a/types.js";
import type { TaskService } from "../task/service.js";
import type { Db } from "../../store/database.js";
import { resolveConclusion } from "./conclusion.js";
import {
  buildAcceptBulletin,
  buildClosureBulletin,
  buildCompletionBulletin,
  buildHandoffBulletin,
  enqueueCollabBulletin,
} from "./bulletin.js";

/**
 * 协作播报收敛点:HTTP 路由与 /mcp 控制工具共用,
 * 保证同一次业务写无论从哪个入口进来,播报语义(①交接/②接单/③完成/④验收)完全一致。
 * 群未配置时不入队;与业务写同库,await 不放大失败面(2026-11-02 裁决)。
 */
export interface AnnounceOptions {
  db: Db;
  chatId?: string;
  now?: () => number;
}

interface TaskClosure {
  id: string;
  title: string;
}

async function announceClosures(
  options: AnnounceOptions,
  autoClosed: ReadonlyArray<TaskClosure>,
): Promise<void> {
  if (options.chatId === undefined) {
    return;
  }
  for (const closed of autoClosed) {
    const conclusion = await resolveConclusion(options.db, closed.id);
    await enqueueCollabBulletin(
      options.db,
      buildClosureBulletin(
        { taskId: closed.id, title: closed.title, conclusion },
        options.chatId,
      ),
      options.now?.(),
    );
  }
}

/** ③ 完成 + ④ 验收:任务置 done 发完成播报,级联收口的根任务逐条发验收播报 */
export async function announceTaskUpdate(
  options: AnnounceOptions,
  service: Pick<TaskService, "completionNotice">,
  task: { id: string; status: string },
  autoClosed: ReadonlyArray<TaskClosure>,
): Promise<void> {
  if (options.chatId === undefined) {
    return;
  }
  if (task.status === "done") {
    const notice = await service.completionNotice(task.id);
    if (notice !== null) {
      await enqueueCollabBulletin(
        options.db,
        buildCompletionBulletin(notice, options.chatId),
        options.now?.(),
      );
    }
  }
  await announceClosures(options, autoClosed);
}

/** ① 交接:a2a_send 发出 request/escalate 后播报;uuid 取消息 id */
export async function announceHandoff(
  options: AnnounceOptions,
  service: Pick<A2aService, "handoffNotice">,
  msgId: string,
): Promise<void> {
  if (options.chatId === undefined) {
    return;
  }
  const notice = await service.handoffNotice(msgId);
  if (notice !== null) {
    await enqueueCollabBulletin(
      options.db,
      buildHandoffBulletin(notice, options.chatId),
      options.now?.(),
    );
  }
}

/** ② 接单 + ④ 验收:ACK 承接播报;request/escalate 收口产生的根任务逐条播报 */
export async function announceAck(
  options: AnnounceOptions,
  service: Pick<A2aService, "acceptNotice">,
  msgId: string,
  childTaskId: string | undefined,
  autoClosed: ReadonlyArray<TaskClosure>,
): Promise<void> {
  if (options.chatId === undefined) {
    return;
  }
  const accept = await service.acceptNotice(msgId, childTaskId);
  if (accept !== null) {
    await enqueueCollabBulletin(
      options.db,
      buildAcceptBulletin(accept, options.chatId),
      options.now?.(),
    );
  }
  await announceClosures(options, autoClosed);
}
