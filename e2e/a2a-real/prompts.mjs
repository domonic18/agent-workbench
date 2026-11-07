// A2A 真机实测提示词:发起侧与接收侧各一份
//
// 提示词正文由控制台的 Agent 接入套件维护(src/mcp/agent-kit/prompts.ts),
// 这里只做转发,避免 e2e 与产品各维护一份措辞。
// 同一份提示词同时给「调度器唤醒」(collector/src/dispatch.ts)与「外部运行时手贴」
// 两种用法,故措辞不带调度器口吻;调度器那份另在 dispatch.ts 内维护。

let impl;

try {
  impl = await import("../../dist/mcp/agent-kit/prompts.js");
} catch (cause) {
  throw new Error(
    "未找到构建产物 dist/mcp/agent-kit/prompts.js,请先运行 make build 再执行 e2e",
    { cause },
  );
}

/** 接收侧六步协议:外部运行时(WorkBuddy / 另一台机的手动会话)贴进工作区提示词用。 */
export const receiverPrompt = impl.receiverPrompt;

/** 发起侧提示词:只委派与确认,不替对方干活;根任务留给系统自动收口 */
export const senderPrompt = impl.senderPrompt;
