// A2A 真机实测提示词:发起侧与接收侧各一份
//
// 接收侧提示词同时给「调度器唤醒」(collector/src/dispatch.ts)与「外部运行时手贴」
// 两种用法,故措辞不带调度器口吻;调度器那份另在 dispatch.ts 内维护。

/**
 * 接收侧六步协议:外部运行时(WorkBuddy / 另一台机的手动会话)贴进工作区提示词用。
 * 具体任务写在收到的消息 summary 里,故本提示词不含任务正文。
 */
export function receiverPrompt() {
  return `你收到一次 A2A 协作委派:控制台的 a2a 收件箱里有待处理消息。这不是群通知,群回复纪律(NOREPLY 抑制)不适用于本次会话;在没有完成下列步骤之前,禁止直接结束回合。
按序完成:
1) 调 a2a_inbox 拉取完整消息,记下 msg_id 与 thread_id;
2) 按收到的 intent 分支:
   - request / escalate:先 task_create 建「你自己名下」的下游任务(标题取消息 summary),再 a2a_ack(msg_id=收到的消息, task_id=你的任务);
   - reply / notify:只 a2a_ack(msg_id=收到的消息) 确认,不要 task_create,也不要再发回执——对回执再回执会形成乒乓,系统据此收口;
3) 只有 request / escalate 才执行消息 summary 里要求的工作,结论写进任务 output;
4) 只有 request / escalate 才 a2a_send 回执:intent=reply,thread_id 与收到的消息一致,reply_to=收到的 msg_id,task_id=你自己的任务,summary 写结论,deadline 必填(填当前时间加 30 分钟的 RFC3339 时间,例如 2026-11-06T09:00:00Z);
5) 只有 request / escalate 才 task_update 按合法路径推进状态直至 done(pending→running→done,不允许跳级)。
过程与结论只写进回执与任务字段。全部步骤完成后,最终回复用一句话概述(消息条数与任务 id)。`;
}

/** 发起侧提示词:只委派与确认,不替对方干活;根任务留给系统自动收口 */
export function senderPrompt({ targetAgentId, title, task, expect, deadline }) {
  return `你作为 A2A 发起方,要把一件小事委派给另一个 Agent(${targetAgentId})。你只做委派,不做对方的工作。
按序完成:
1) task_create 建「你自己名下」的任务(标题:${title}),记下 task_id;
2) a2a_send(intent=request, to=${targetAgentId}, task_id=你刚建的任务, summary=${task}, expect=${expect}, deadline=${deadline});
3) 到此结束本回合:不要执行任务本身,不要替对方回答,也不要推进自己任务的状态——根任务由系统在对端回执确认后自动收口;
4) 最终回复用一句话说明:已委派任务 <task_id> 给 ${targetAgentId}。`;
}
