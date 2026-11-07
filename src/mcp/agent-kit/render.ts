import { MCP_ACCESS, TOOL_GATE, formatBearer } from "../../shared/constants.js";
import type { ConsoleTool } from "../console-shared.js";
import { PROTOCOL_GUIDE } from "./protocol.js";

/** 工具速查表的一行:从 ConsoleTool 定义直接投影,不做静态副本 */
export interface ToolSummary {
  name: string;
  /** 闸门级别:L0 只读,L1 可写 */
  gate: "L0" | "L1";
  /** 用途:工具 description 的首句 */
  purpose: string;
  required: string[];
  optional: string[];
}

export interface GuideOptions {
  /** 对外可达的控制台地址;缺省时写占位符 */
  publicUrl?: string | undefined;
}

/** description 首句即用途;工具说明本身已是自解释口径 */
function firstSentence(description: string): string {
  // 工具说明用「。」「;」「；」分段,取位置最靠前的那个标点切开
  const stops = ["。", ";", "；"]
    .map((mark) => description.indexOf(mark))
    .filter((index) => index >= 0);
  const cut = stops.length === 0 ? description.length : Math.min(...stops);
  return description.slice(0, cut).trim();
}

function gateLevel(gateName: string): "L0" | "L1" {
  return (TOOL_GATE.l0 as readonly string[]).includes(gateName) ? "L0" : "L1";
}

/** 从真实注册表派生工具速查表;工具改名或改参数,表跟着变 */
export function toolSummaries(tools: readonly ConsoleTool[]): ToolSummary[] {
  return tools.map((tool) => {
    const schema = tool.inputSchema as {
      properties?: Record<string, unknown>;
      required?: readonly string[];
    };
    const required = [...(schema.required ?? [])];
    const optional = Object.keys(schema.properties ?? {}).filter(
      (name) => !required.includes(name),
    );
    return {
      name: tool.name,
      gate: gateLevel(tool.gateName),
      purpose: firstSentence(tool.description),
      required,
      optional,
    };
  });
}

function endpoint(publicUrl: string | undefined): string {
  const base = publicUrl === undefined || publicUrl === "" ? "<控制台地址>" : publicUrl;
  return `${base}${MCP_ACCESS.path}`;
}

function accessSection(publicUrl: string | undefined): string {
  const placeholder = publicUrl === undefined || publicUrl === "";
  return `## 十三、如何接入控制台 MCP

- 端点:\`${endpoint(publicUrl)}\`——Streamable HTTP,只接受 POST(GET / DELETE 返回 405)
- 鉴权头:\`${MCP_ACCESS.authHeader}: ${MCP_ACCESS.bearerFormat}\`
- 凭据:控制台「协作接入」页可为每个 Agent 签发或轮换密钥,明文只显示一次
${placeholder ? "- 端点里的 `<控制台地址>` 是占位符:控制台未配置对外地址,填你实际连控制台的地址(协议正文里的路径都是相对的,照原样接在后面即可)\n" : ""}- 客户端配置片段:

\`\`\`json
{
  "mcpServers": {
    "aw-console": {
      "type": "http",
      "url": "${endpoint(publicUrl)}",
      "headers": {
        "${MCP_ACCESS.authHeader}": "${formatBearer("<agentId>", "<secret>")}"
      }
    }
  }
}
\`\`\`

没配 MCP 也能协作:第十二节的 REST 通道用同一份 Bearer,直接请求控制台接口即可。
`;
}

function toolTableSection(summaries: readonly ToolSummary[]): string {
  const rows = summaries.map(
    (item) =>
      `| \`${item.name}\` | ${item.gate} | ${item.purpose} | ${item.required.join(", ") || "—"} | ${item.optional.join(", ") || "—"} |`,
  );
  return `## 十四、工具速查表

| 工具 | 闸门 | 用途 | 必填参数 | 可选参数 |
|---|---|---|---|---|
${rows.join("\n")}

闸门级别:L0 只读,L1 可写。参数以各工具的 schema 为准,本表随控制台版本同步。
`;
}

/** 人读的完整指南:规范正文 + 接入方式 + 工具速查表 */
export function renderAgentGuide(
  tools: readonly ConsoleTool[],
  options: GuideOptions = {},
): string {
  return `${PROTOCOL_GUIDE}\n---\n\n${accessSection(options.publicUrl)}\n${toolTableSection(toolSummaries(tools))}`;
}

/**
 * Claude Code skill 格式的 SKILL.md:frontmatter 声明何时加载,正文是可执行的协作口径。
 * 只含协议与公开接入参数,不含任何凭据。
 */
export function renderAgentSkill(
  tools: readonly ConsoleTool[],
  options: GuideOptions = {},
): string {
  const frontmatter = [
    "---",
    "name: aw-a2a",
    "description: 在 agent-workbench 控制台上做多 Agent 协作(A2A)时使用:如何建任务、发消息、接委派、回执与关单,以及可用工具速查。",
    "---",
    "",
  ].join("\n");
  return `${frontmatter}${renderAgentGuide(tools, options)}`;
}
