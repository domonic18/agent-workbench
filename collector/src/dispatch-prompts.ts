import { MCP_SERVER_NAME } from "./config-sync.js";

/** 六步协议提示词:按收到消息的 intent 分支;变更需同步 docs/arch/04 */
export const DISPATCH_PROMPT = `这是一次由执行面调度器发起的协作唤醒:你的 a2a 收件箱存在未处理消息。这不是群通知,群回复纪律(NOREPLY 抑制)不适用于本次会话;在没有完成下列步骤之前,禁止直接结束回合。
按序完成:
1) 调 a2a_inbox 拉取完整消息,记下 msg_id 与 thread_id;
2) 按收到的 intent 分支:
   - request / escalate:先 task_create 建「你自己名下」的下游任务,再 a2a_ack(msg_id=收到的消息, task_id=你的任务);
   - reply / notify:只 a2a_ack(msg_id=收到的消息) 确认,不要 task_create;
3) 只有 request / escalate 才执行消息要求的本职工作(读文件、查代码、写结论);reply 只需读懂结论;
4) 只有 request / escalate 才 a2a_send 回执:task_id 用你自己的任务,必须带 thread_id 回原线程,intent=reply,reply_to=收到的 msg_id,结论写进 summary,deadline 必填;收到的是 reply 时不要再发回执——对回执再回执会形成乒乓,系统据此收口;
5) 只有 request / escalate 才 task_update 推进自己名下任务:开工先 status=running,收尾 status=done——关单只需 status=done,stage 可停在任意阶段;stage 与 status 相互独立,不要把 review 直接跳到 closed(非法跃迁,会报错)。
过程与结论只写进回执与任务字段。全部步骤完成后,最终回复用一句话概述处理结果(消息条数与任务 id)。`;

/** 会话可用工具:读文件、查代码、跑命令,以及控制台 MCP(拉收件箱、建任务、回执) */
export const ALLOWED_TOOLS = ["Read", "Grep", "Glob", "Bash", `mcp__${MCP_SERVER_NAME}`].join(",");

/**
 * 工作唤醒提示词(M3.10-3 批次化):work 收件箱有待领取派工时使用,变更需同步 docs/arch/04。
 * 六条纪律:领全部 pending / 单批上限注入 / 单分支分 commit / 一个 PR 逐行 Fixes / 单件 handback 不卡整批 / 开工前 git status 竞态自查。
 * 接受/验收是原 Bug 机器人的人工动作,不在本会话职责内;生产发布始终单独确认。
 */
export function workDispatchPrompt(maxItems: number): string {
  return `这是一次由执行面调度器发起的工作唤醒:你的工作收件箱(work_inbox)存在待领取派工。这不是群通知;在没有完成下列步骤之前,禁止直接结束回合。
按序完成:
0) 开工前自查:先跑 git status --porcelain;若已有输出,说明调度闸门放行后工作区又被占用——此时不要领取、不要动手,直接回复「工作区被占用」结束本回合,等下一轮调度重新放行;
1) work_inbox 领取全部待处理行,记下 inbox_id 与 work_item_id;单批最多 ${maxItems} 件,超出部分留在收件箱等下一批,不要贪多;
2) 逐件承接:work_read 读事项 Mandate 与事件历史;task_create(带 work_item_id)建你名下的承接任务并记下 task_id;work_ack(inbox_id=派工行, task_id=承接任务)确认承接;
3) 批次执行:同批全部事项在同一个语义化分支上修复,按件分开 commit,格式 fix: #<N> 事项标题(issue 编号从 Mandate 与事项引用/事件 payload 中取,取不到就回查 bug 反馈原文,不许猜);修复本身按 expected_result,不超出 Mandate 范围,不顺手重构;
4) 一个 PR:全部修复完成后 gh pr create 只提一个 PR,body 逐行列出每件的 "Fixes #<N>"(GitHub 合并即逐 issue 关闭;但各事项仍独立走原反馈机器人的人工接受收口,PR 关闭 issue 不替代验收);
5) task_update 逐件推进承接任务:开工先 status=running,收尾 status=done(关单只需 status=done,stage 与 status 相互独立),output 写清 PR URL 与该件的修复摘要;
6) 确实超出能力或范围的单件用 work_handback(inbox_id, reason)退回,其余照常交付——不因一件卡整批;不要用 work_handback 替代失败后的重试。
过程与结论只写进任务字段与 PR 描述。全部步骤完成后,最终回复用一句话概述(处理件数、任务 id、PR URL、退回件数)。`;
}
