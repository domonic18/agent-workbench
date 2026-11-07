import { describe, expect, it } from "vitest";
import type { ConsoleTool } from "../console-shared.js";
import { renderAgentGuide, renderAgentSkill, toolSummaries } from "./render.js";

const tools: ConsoleTool[] = [
  {
    name: "a2a_send",
    gateName: "a2a.send",
    description: "向委派白名单内的 Agent 发送 A2A 消息;from 与 round 由服务端注入。",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        to: { type: "string" },
        cursor: { type: "string" },
      },
      required: ["task_id", "to"],
    },
    auditTaskId: () => null,
    execute: async () => ({ content: [] }),
  },
  {
    name: "a2a_inbox",
    gateName: "a2a.inbox",
    description: "拉取发给当前 Agent 的 A2A 消息,默认长轮询 25 秒;返回即已领取,须 ACK。",
    inputSchema: {
      type: "object",
      properties: { cursor: { type: "string" } },
    },
    auditTaskId: () => null,
    execute: async () => ({ content: [] }),
  },
];

describe("Agent 手册渲染", () => {
  it("工具速查表按闸门分级并拆出必填与可选参数", () => {
    const summaries = toolSummaries(tools);
    expect(summaries.map((item) => item.name)).toEqual(["a2a_send", "a2a_inbox"]);
    expect(summaries[0]?.gate).toBe("L1");
    expect(summaries[0]?.required).toEqual(["task_id", "to"]);
    expect(summaries[0]?.optional).toEqual(["cursor"]);
    expect(summaries[1]?.gate).toBe("L0");
    // 用途取 description 首句
    expect(summaries[0]?.purpose).toBe("向委派白名单内的 Agent 发送 A2A 消息");
  });

  it("指南含规范正文、接入段与工具表", () => {
    const guide = renderAgentGuide(tools);
    expect(guide).toContain("## 零、接入自检");
    expect(guide).toContain("## 五、接收侧六步");
    expect(guide).toContain("## 十二、REST 通道");
    expect(guide).toContain("## 十三、如何接入控制台 MCP");
    expect(guide).toContain("| `a2a_send` | L1 |");
    expect(guide).toContain("<控制台地址>/mcp");
  });

  it("REST 通道写明请求面,且强调别用 IM 代替委派", () => {
    const guide = renderAgentGuide(tools);
    expect(guide).toContain("/api/a2a/messages");
    expect(guide).toContain("/api/a2a/inbox");
    expect(guide).toContain("/api/agent/peers");
    expect(guide).toContain("Idempotency-Key");
    expect(guide).toContain("不要用 IM 代替委派");
    // 白名单属于发起方:别用对方的名单判断自己能不能发
    expect(guide).toContain("委派白名单属于**发起方**");
  });

  it("给了对外地址就把端点换成真值", () => {
    const guide = renderAgentGuide(tools, { publicUrl: "https://aw.example.com" });
    expect(guide).toContain("https://aw.example.com/mcp");
    expect(guide).not.toContain("<控制台地址>");
  });

  it("skill 是合法 frontmatter 加正文", () => {
    const skill = renderAgentSkill(tools);
    expect(skill.startsWith("---\nname: aw-a2a\n")).toBe(true);
    expect(skill).toContain("description:");
    expect(skill).toContain("## 五、接收侧六步");
  });

  it("指南不含任何凭据材料", () => {
    for (const text of [renderAgentGuide(tools), renderAgentSkill(tools)]) {
      expect(text).not.toContain("scrypt$");
      expect(text).not.toContain("Bearer agt_");
    }
  });
});
