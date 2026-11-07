import { textResult, type ConsoleTool, type ConsoleToolDeps } from "../console-shared.js";
import { PROTOCOL_GUIDE } from "./protocol.js";

/**
 * a2a_guide:Agent 自助拉取协作规范。
 *
 * 只返回叙事正文,不含工具速查表——工具清单由 tools/list 给出(服务端渲染表时会自指,徒增耦合)。
 * 无参数、无副作用,不写审计任务维度。
 */
export function createGuideTools(_deps: ConsoleToolDeps): ConsoleTool[] {
  return [
    {
      name: "a2a_guide",
      gateName: "guide.read",
      description:
        "读取本控制台的 A2A 协作规范与工作纪律;不确定下一步该调哪个工具、消息怎么写、回执该带不带 task_id 时先读它。",
      inputSchema: { type: "object", properties: {} },
      auditTaskId: () => null,
      execute: async () =>
        textResult({
          guide: PROTOCOL_GUIDE,
          hint: "本机可用工具与参数请用 tools/list 查看。",
        }),
    },
  ];
}
