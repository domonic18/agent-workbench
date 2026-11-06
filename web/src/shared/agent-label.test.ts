import { describe, expect, it } from "vitest";
import {
  agentDisplayName,
  agentMention,
  agentMentionLabel,
  agentNameMap,
  hasCollector,
} from "./agent-label.js";

const WITH_BOT = { id: "agt_a", displayName: "cc-connect 项目名", feishuBotName: "小工" };
const WITHOUT_BOT = { id: "agt_b", displayName: "cc-connect 项目名", feishuBotName: null };

describe("Agent 展示名", () => {
  it("飞书 bot 名优先,回退控制台 displayName", () => {
    expect(agentDisplayName(WITH_BOT)).toBe("小工");
    expect(agentDisplayName(WITHOUT_BOT)).toBe("cc-connect 项目名");
  });

  it("引用写法带 @,与飞书群里的称呼一致", () => {
    expect(agentMention(WITH_BOT)).toBe("@小工");
  });

  it("名册外的 Agent 原样返回后端标签,不硬加 @", () => {
    const names = agentNameMap([WITH_BOT]);
    expect(agentMentionLabel("agt_a", names, "已删除 Agent")).toBe("@小工");
    expect(agentMentionLabel("agt_gone", names, "已删除 Agent")).toBe("已删除 Agent");
  });
});

describe("过程数据可见性", () => {
  it("只有 claude_code 且绑了机器的 Agent 才有 aw-node 过程数据", () => {
    expect(hasCollector({ runtime: "claude_code", machineId: "m1" })).toBe(true);
    expect(hasCollector({ runtime: "claude_code", machineId: null })).toBe(false);
    expect(hasCollector({ runtime: "workbuddy", machineId: "m1" })).toBe(false);
    expect(hasCollector({ runtime: "workbuddy", machineId: null })).toBe(false);
  });
});
