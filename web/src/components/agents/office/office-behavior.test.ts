import { describe, expect, it } from "vitest";
import type { OverviewAgent } from "../../../api/types.js";
import {
  officeBubbleOf,
  officeClipOf,
  officeSleepyOf,
  officeTransitionOf,
} from "./office-behavior.js";

const AT = 1_700_000_000_000;

function live(overrides: Partial<OverviewAgent> = {}): OverviewAgent {
  return {
    id: "agt_a",
    displayName: "构建 Agent",
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
    ...overrides,
  };
}

describe("办公室持续动作", () => {
  it("工作中：有指令打字，没指令安静工作", () => {
    expect(officeClipOf("running", live({ running: true }))).toBe("work.quiet-back");
    expect(
      officeClipOf("running", live({ running: true, currentInstruction: "补充均线位" })),
    ).toBe("work.typing-back");
  });

  it("其余状态各有一个固定姿势", () => {
    expect(officeClipOf("idle", live())).toBe("idle.back");
    expect(officeClipOf("hold", live())).toBe("pose.lean");
    expect(officeClipOf("offline", live())).toBe("idle.back");
    expect(officeClipOf("disabled", live())).toBe("idle.back");
  });
});

describe("办公室过渡动作", () => {
  it("首帧没有上一状态，不产过渡", () => {
    expect(officeTransitionOf(undefined, "running")).toBeNull();
  });

  it("待命与工作之间来回才有起落动作", () => {
    expect(officeTransitionOf("idle", "running")?.clip).toBe("sit-down.back");
    expect(officeTransitionOf("running", "idle")?.clip).toBe("stand-up.back");
  });

  it("挂起、离线、停用之间不产过渡", () => {
    expect(officeTransitionOf("idle", "hold")).toBeNull();
    expect(officeTransitionOf("hold", "offline")).toBeNull();
    expect(officeTransitionOf("offline", "disabled")).toBeNull();
    expect(officeTransitionOf("running", "hold")).toBeNull();
  });

  it("过渡动作带上自己的时长", () => {
    expect(officeTransitionOf("idle", "running")?.durationMs).toBeGreaterThan(0);
  });
});

describe("办公室头顶气泡", () => {
  it("工作中优先说阶段，没有阶段才说指令", () => {
    expect(
      officeBubbleOf("running", live({ running: true, currentTaskStage: "exec" }))?.text,
    ).toBe("执行");
    expect(
      officeBubbleOf("running", live({ running: true, currentInstruction: "补充均线位" }))?.text,
    ).toBe("补充均线位");
    expect(officeBubbleOf("running", live({ running: true }))?.text).toBe("执行中");
  });

  it("指令过长时截断，只占一格", () => {
    const bubble = officeBubbleOf(
      "running",
      live({ running: true, currentInstruction: "这是一条很长的指令需要被截断" }),
    );
    expect(bubble?.text).toBe("这是一条很长的指令需…");
  });

  it("派发挂起说明挂起原因", () => {
    const bubble = officeBubbleOf("hold", live({ dispatchHold: "cwd_missing" }));
    expect(bubble?.text).toBe("目录不存在");
    expect(bubble?.tone).toBe("danger");
  });

  it("刚跑完的 Agent 说刚刚完成，隔久了就不说", () => {
    const justDone = live({ lastRunEndedAt: AT - 30_000 });
    expect(officeBubbleOf("idle", justDone, AT)?.text).toBe("刚刚完成");
    expect(officeBubbleOf("idle", justDone, AT)?.tone).toBe("positive");
    expect(officeBubbleOf("idle", justDone, AT + 120_000)).toBeNull();
  });

  it("待命与离线不占气泡位置", () => {
    expect(officeBubbleOf("idle", live())).toBeNull();
    expect(officeBubbleOf("offline", live())).toBeNull();
    expect(officeBubbleOf("disabled", live())).toBeNull();
  });
});

describe("办公室打盹", () => {
  it("离线与停用才打盹", () => {
    expect(officeSleepyOf("offline", live(), AT)).toBe(true);
    expect(officeSleepyOf("disabled", live(), AT)).toBe(true);
    expect(officeSleepyOf("idle", live(), AT)).toBe(false);
    expect(officeSleepyOf("running", live({ running: true }), AT)).toBe(false);
  });

  it("刚忙完的 Agent 不打盹", () => {
    const justDone = live({ lastRunEndedAt: AT - 30_000 });
    expect(officeSleepyOf("offline", justDone, AT)).toBe(false);
    expect(officeSleepyOf("offline", justDone, AT + 120_000)).toBe(true);
  });
});
