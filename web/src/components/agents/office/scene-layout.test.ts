import { describe, expect, it } from "vitest";
import type { AgentRosterSummary } from "../../../api/identity.js";
import type { OverviewAgent } from "../../../api/types.js";
import { buildScene, createStageMapper } from "./scene-layout.js";

function agent(id: string, name: string, machineId: string | null): AgentRosterSummary {
  return {
    id,
    machineId,
    runtime: "claude_code",
    project: "aw",
    displayName: name,
    feishuAppId: null,
    feishuBotName: null,
    status: "active",
    allowedTargets: [],
    createdAt: 0,
    updatedAt: 0,
    key: null,
    usageLimit: null,
    machineHostname: machineId === null ? null : "build-box",
    machineDisplayName: machineId === null ? null : "构建机",
    totalRuns: 0,
    totalTokens: 0,
    openTasks: 0,
    lastRunAt: null,
  };
}

function live(id: string): OverviewAgent {
  return {
    id,
    displayName: "Agent",
    feishuBotName: null,
    project: "aw",
    machineId: "m1",
    runtime: "claude_code",
    machineHostname: "build-box",
    machineDisplayName: null,
    machineLastSeenAt: 0,
    heartbeat: "ok",
    activeSessions: null,
    lastRunAt: null,
    lastRunEndedAt: null,
    running: false,
    currentTaskId: null,
    currentTaskTitle: null,
    currentTaskStage: null,
    currentTaskStatus: null,
    currentInstruction: null,
    dispatchHold: null,
    dispatchPending: null,
    dispatchHoldSince: null,
    todayTokens: 0,
  };
}

describe("办公室场景布局模型", () => {
  it("按机器分区，标签带机器名与工位数", () => {
    const scene = buildScene(
      [agent("a", "构建 Agent", "m1"), agent("b", "外部 Agent", null)],
      new Map([["a", live("a")]]),
    );

    expect(scene.stations).toHaveLength(2);
    expect(scene.zones.map((zone) => zone.label)).toEqual(["构建机", "未绑定机器"]);
    expect(scene.zones.map((zone) => zone.count)).toEqual([1, 1]);
  });

  it("工位带上状态与对应动作", () => {
    const scene = buildScene([agent("a", "构建 Agent", "m1")], new Map([["a", live("a")]]));

    expect(scene.stations[0]).toMatchObject({ state: "idle", clip: "idle.back" });
  });

  it("覆盖层宽度随工位间距收敛，窄容器下不越界也不写死", () => {
    const scene = buildScene([agent("a", "构建 Agent", "m1")], new Map([["a", live("a")]]));
    const slot = scene.stations[0]?.slot;
    if (slot === undefined) throw new Error("场景没有工位");

    const wide = createStageMapper({ scale: 1, roomScale: 1, origin: scene.origin });
    const narrow = createStageMapper({ scale: 0.3, roomScale: 1, origin: scene.origin });

    expect(wide.overlayWidthOf(slot)).toBeLessThanOrEqual(150);
    expect(narrow.overlayWidthOf(slot)).toBeLessThan(wide.overlayWidthOf(slot));
    // 收窄后仍留得下一枚图标与几个字
    expect(narrow.overlayWidthOf(slot)).toBeGreaterThanOrEqual(32);
    expect(narrow.pitchOf(slot)).toBeLessThan(wide.pitchOf(slot));
  });

  it("工位局部坐标换算成舞台坐标，行层缩放一并进换算", () => {
    const scene = buildScene([agent("a", "构建 Agent", "m1")], new Map([["a", live("a")]]));
    const slot = scene.stations[0]?.slot;
    if (slot === undefined) throw new Error("场景没有工位");

    const mapper = createStageMapper({ scale: 1, roomScale: 1, origin: scene.origin });
    const atOrigin = mapper.toStage(slot, 0, 0);

    expect(atOrigin.left).toBeGreaterThan(0);
    expect(atOrigin.top).toBeGreaterThan(0);
    // 舞台整体缩放后坐标同比缩小
    const half = createStageMapper({ scale: 0.5, roomScale: 1, origin: scene.origin });
    expect(half.toStage(slot, 0, 0).left).toBeCloseTo(atOrigin.left * 0.5, 5);
  });
});
