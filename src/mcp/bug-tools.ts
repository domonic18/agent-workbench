import { buildWorkPolicy } from "../domain/routing/policy.js";
import { WorkError } from "../domain/work/errors.js";
import type { WorkItemRecord } from "../domain/work/ownership.js";
import { resolveBugOwnedItem } from "../domain/work/ownership.js";
import {
  errorResult,
  optionalText,
  textResult,
  type ConsoleTool,
  type ConsoleToolDeps,
} from "./console-shared.js";

/**
 * bug 机器人两工具(M3.9-2):work_report 建 Bug 单上报、work_decide 人工
 * 裁决回传。归属判定都在服务端:report 只收注册表内的项目;decide 只认
 * 上报该 Bug 的机器人(origin 触发 actor.agent_id === Bearer 身份),
 * 按 issue_ref 线程定位事项,不猜「最近」。幂等键:report 按 issue、
 * decide 按消息(退回可反复发生)。
 */
export function createBugTools(deps: ConsoleToolDeps): ConsoleTool[] {
  const now = deps.now ?? Date.now;

  return [
    {
      name: "work_report",
      gateName: "work.report",
      description:
        "上报 Bug 建工作事项:按 issue_ref(仓库内 issue URL)幂等,同一 issue 重复上报返回首次处置;" +
        "thread_key 是原反馈渠道 chat_id(私聊或群都可,取不到原消息 id 时只给 chat_id),供事项归属与追溯;" +
        "状态卡片统一发到控制台协作群,不依赖 thread_key。",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: "已登记的项目名" },
          title: { type: "string" },
          detail: { type: "string", description: "现象、复现步骤等补充" },
          issue_ref: { type: "string", description: "issue 完整 URL" },
          thread_key: {
            type: "string",
            description: "原反馈渠道 chat_id,带原消息 id 时为 `chat_id:message_id`",
          },
        },
        required: ["project", "title", "issue_ref", "thread_key"],
      },
      auditTaskId: () => null,
      execute: async (agent, args) => {
        const project = optionalText(args.project);
        const title = optionalText(args.title);
        const issueRef = optionalText(args.issue_ref);
        const threadKey = optionalText(args.thread_key);
        const detail = optionalText(args.detail);
        if (
          project === undefined ||
          title === undefined ||
          issueRef === undefined ||
          threadKey === undefined
        ) {
          return errorResult("project、title、issue_ref 与 thread_key 必填");
        }
        if (buildWorkPolicy().registry[project] === undefined) {
          return errorResult(`VALIDATION_FAILED: 项目 ${project} 未在注册表登记,无法派工`);
        }
        const result = await deps.ingest({
          source: "bug",
          sourceEventId: `report:${issueRef}`,
          kind: "submitted",
          occurredAt: now(),
          actor: { agent_id: agent.id, agent_key: agent.key },
          project,
          threadRefs: [{ source: "bug", externalKind: "issue", externalKey: issueRef }],
          payload: {
            title,
            ...(detail === undefined ? {} : { detail }),
            thread_key: threadKey,
          },
          refs: [],
        });
        return textResult({
          replayed: result.replayed,
          disposition: result.trigger.disposition,
          reason_code: result.trigger.reasonCode,
          work_item:
            result.workItem === undefined
              ? null
              : {
                  id: result.workItem.id,
                  title: result.workItem.title,
                  status: result.workItem.status,
                },
        });
      },
    },
    {
      name: "work_decide",
      gateName: "work.decide",
      description:
        "回传人工裁决:接受(accepted)即收口事项;退回(returned)使同一事项返工。" +
        "只有上报该 Bug 的机器人可调用;退回必须给出 reason。",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["accepted", "returned"] },
          issue_ref: { type: "string", description: "issue 完整 URL,与上报时一致" },
          reason: { type: "string", description: "退回理由,returned 必填" },
          message_id: { type: "string", description: "裁决消息 id,重复下发幂等" },
        },
        required: ["action", "issue_ref"],
      },
      auditTaskId: () => null,
      execute: async (agent, args) => {
        const action = optionalText(args.action);
        const issueRef = optionalText(args.issue_ref);
        const reason = optionalText(args.reason);
        const messageId = optionalText(args.message_id);
        if (action !== "accepted" && action !== "returned") {
          return errorResult("action 须为 accepted 或 returned");
        }
        if (issueRef === undefined) {
          return errorResult("issue_ref 必填");
        }
        if (action === "returned" && reason === undefined) {
          return errorResult("退回必须给出 reason");
        }

        const item = await resolveBugOwnedItem(deps.db, agent.id, issueRef);
        if (item.status === "done") {
          if (action === "accepted") {
            return textResult({
              ok: true,
              replayed: true,
              disposition: "continued",
              work_item: summarize(item),
              note: "该事项此前已接受收口",
            });
          }
          throw new WorkError("CONFLICT", "事项已完成,不能退回;请重新上报");
        }
        if (item.status === "cancelled") {
          throw new WorkError("CONFLICT", "事项已取消,无可裁决事项");
        }

        const at = now();
        const result = await deps.ingest({
          source: "bug",
          sourceEventId: `decide:${issueRef}:${action}:${messageId ?? at}`,
          kind: action,
          occurredAt: at,
          actor: { agent_id: agent.id, agent_key: agent.key },
          project: item.project,
          threadRefs: [{ source: "bug", externalKind: "issue", externalKey: issueRef }],
          payload: {
            action,
            ...(reason === undefined ? {} : { reason }),
            ...(messageId === undefined ? {} : { message_id: messageId }),
          },
          refs: [],
        });
        const decided = result.workItem ?? item;
        return textResult({
          ok: true,
          replayed: result.replayed,
          disposition: result.trigger.disposition,
          reason_code: result.trigger.reasonCode,
          work_item: summarize(decided),
        });
      },
    },
  ];
}

function summarize(item: WorkItemRecord): Record<string, unknown> {
  return { id: item.id, status: item.status, stage: item.stage, attention: item.attention };
}
