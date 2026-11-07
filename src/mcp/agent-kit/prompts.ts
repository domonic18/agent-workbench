/**
 * 工作区提示词模板:外部运行时(WorkBuddy / 另一台机的手动会话)贴进工作区用。
 *
 * 与 PROTOCOL_GUIDE 的关系:规范是完整口径,这里是可直接粘贴的最小指令集——具体任务写在收到的消息 summary 里,故不含任务正文。
 */

/** 接收侧提示词:贴给「会收到 A2A 委派」的 Agent */
export function receiverPrompt(): string {
  return `你收到一次 A2A 协作委派:控制台的 a2a 收件箱里有待处理消息。这不是群通知,群回复纪律(NOREPLY 抑制)不适用于本次会话;在没有完成下列步骤之前,禁止直接结束回合。
按序完成:
1) 调 a2a_inbox 拉取完整消息,记下 msg_id 与 thread_id;
2) 按收到的 intent 分支:
   - request / escalate:先 task_create 建「你自己名下」的下游任务(标题取消息 summary),再 a2a_ack(msg_id=收到的消息, task_id=你的任务);
   - reply / notify:只 a2a_ack(msg_id=收到的消息) 确认,不要 task_create,也不要再发回执——对回执再回执会形成乒乓,系统据此收口;
3) 只有 request / escalate 才执行消息 summary 里要求的工作,结论写进任务 output;
4) 只有 request / escalate 才 a2a_send 回执:intent=reply,thread_id 与收到的消息一致,reply_to=收到的 msg_id,task_id=你自己的任务,summary 写结论,deadline 必填(填当前时间加 30 分钟的 RFC3339 时间);
5) 只有 request / escalate 才 task_update 推进自己名下任务:开工先 status=running,收尾 status=done——关单只需 status=done,stage 可停在任意阶段;
过程与结论只写进回执与任务字段。全部步骤完成后,最终回复用一句话概述(消息条数与任务 id)。`;
}

export interface SenderPromptInput {
  /** 收件方 Agent ID */
  targetAgentId: string;
  /** 根任务标题 */
  title: string;
  /** 要对方做的事 */
  task: string;
  /** 要对方交付的东西 */
  expect: string;
  /** 期望完成时间(RFC3339) */
  deadline: string;
}

/** 发起侧提示词:只委派与确认,不替对方干活;根任务留给系统自动收口 */
export function senderPrompt(input: SenderPromptInput): string {
  return `你作为 A2A 发起方,要把一件小事委派给另一个 Agent(${input.targetAgentId})。你只做委派,不做对方的工作。
按序完成:
1) task_create 建「你自己名下」的任务(标题:${input.title}),记下 task_id;
2) a2a_send(intent=request, to=${input.targetAgentId}, task_id=你刚建的任务, summary=${input.task}, expect=${input.expect}, deadline=${input.deadline});
3) 到此结束本回合:不要执行任务本身,不要替对方回答,也不要推进自己任务的状态——根任务由系统在对端回执确认后自动收口;
4) 最终回复用一句话说明:已委派任务 <task_id> 给 ${input.targetAgentId}。`;
}

/** 发起侧提示词模板:给人先看形状,填好四项后再用 */
export function senderPromptTemplate(): string {
  return senderPrompt({
    targetAgentId: "<目标 Agent ID>",
    title: "<根任务标题>",
    task: "<要对方做的事>",
    expect: "<要对方交付的东西>",
    deadline: "<期望完成时间,RFC3339>",
  });
}
