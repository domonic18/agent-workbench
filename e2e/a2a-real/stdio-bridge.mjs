// MCP stdio↔HTTP 桥:R1 兜底
//
// 场景:WorkBuddy 连接器只支持 stdio,或不允许配自定义 Authorization 头。
// 本桥把 stdio 的 JSON-RPC 逐行转发到控制台 /mcp,并注入 Agent Bearer;
// 判定仍在控制台侧,桥只做转发,不做任何策略。
//
// 用法(WorkBuddy MCP 配置):
//   {
//     "mcpServers": {
//       "aw-console": {
//         "type": "stdio",
//         "command": "node",
//         "args": ["/绝对路径/e2e/a2a-real/stdio-bridge.mjs"],
//         "env": {
//           "AW_A2A_BEARER": "<agentId>.<secret>",
//           "AW_A2A_URL": "https://<控制台>"
//         }
//       }
//     }
//   }
//
// 凭据只走 env,不进命令行参数与日志。
import { createInterface } from "node:readline";

const bearer = process.env.AW_A2A_BEARER ?? "";
const base = (process.env.AW_A2A_URL ?? "https://aw.example.com").replace(/\/$/, "");
if (bearer === "") {
  process.stderr.write("缺少 AW_A2A_BEARER 环境变量\n");
  process.exit(2);
}

async function forward(message) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(message),
  });
  const text = await response.text();
  if (!response.ok) {
    process.stderr.write(`上游返回 HTTP ${response.status}: ${text.slice(0, 200)}\n`);
    return null;
  }
  // 通知类消息无响应体
  if (text.trim() === "") {
    return null;
  }
  return text.trim();
}

const input = createInterface({ input: process.stdin });
for await (const line of input) {
  const trimmed = line.trim();
  if (trimmed === "") {
    continue;
  }
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    process.stderr.write("跳过非 JSON 行\n");
    continue;
  }
  try {
    const body = await forward(message);
    if (body !== null) {
      process.stdout.write(`${body}\n`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`转发失败: ${reason}\n`);
    if (message.id !== undefined) {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: reason } })}\n`,
      );
    }
  }
}
