import { describe, expect, it } from "vitest";
import type { AgentSummary } from "../../api/identity.js";
import type { AgentGroupSummary } from "../../api/types.js";
import { layerLevels, layoutGraph, nodeAt } from "./layout.js";

function agent(id: string, targets: string[] = []): AgentSummary {
  return {
    id,
    machineId: null,
    runtime: "claude_code",
    project: "aw",
    displayName: id,
    feishuAppId: null,
    feishuBotName: null,
    status: "active",
    allowedTargets: targets,
    createdAt: 0,
    updatedAt: 0,
    key: null,
    usageLimit: null,
  };
}

function group(id: string, memberIds: string[] = []): AgentGroupSummary {
  return { id, name: id, memberIds, createdAt: 0, updatedAt: 0 };
}

describe("委派图布局", () => {
  it("收件方按发起方分层", () => {
    const levels = layerLevels([agent("a", ["b"]), agent("b", ["c"]), agent("c")]);

    expect(levels.get("a")).toBe(0);
    expect(levels.get("b")).toBe(1);
    expect(levels.get("c")).toBe(2);
  });

  it("成环不死循环,按 0 层截断", () => {
    const levels = layerLevels([agent("a", ["b"]), agent("b", ["a"])]);

    expect(levels.get("a")).toBeDefined();
    expect(levels.get("b")).toBeDefined();
  });

  it("边按白名单生成,自我委派不成边", () => {
    const layout = layoutGraph([agent("a", ["b", "a"]), agent("b")]);

    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]?.from.key).toBe("a");
    expect(layout.edges[0]?.to.key).toBe("b");
  });

  it("草稿态的目标集合优先于已保存态", () => {
    const layout = layoutGraph([agent("a", ["b"]), agent("b")], [], () => []);

    expect(layout.edges).toHaveLength(0);
  });

  it("组是独立节点,排在 Agent 列之后", () => {
    const layout = layoutGraph([agent("a", ["grp_1"]), agent("b")], [group("grp_1", ["b"])]);

    const groupNode = layout.nodes.find((node) => node.key === "grp_1");
    const agentNode = layout.nodes.find((node) => node.key === "a");
    expect(groupNode?.kind).toBe("group");
    expect(groupNode?.x ?? 0).toBeGreaterThan(agentNode?.x ?? 0);
    // 授权整组只画一条边,不是给每个成员各画一条
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]?.to.kind).toBe("group");
  });

  it("命中测试落在哪个节点上", () => {
    const layout = layoutGraph([agent("a"), agent("b")]);
    const node = layout.nodes[0];
    if (node === undefined) throw new Error("没有节点");

    expect(nodeAt(layout.nodes, node.x + 5, node.y + 5)?.key).toBe(node.key);
    expect(nodeAt(layout.nodes, -50, -50)).toBeNull();
  });
});
