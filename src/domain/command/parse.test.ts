import { describe, expect, it } from "vitest";
import { parseCommand } from "./parse.js";

describe("parseCommand", () => {
  it("识别已登记的英文斜杠命令,命令名不区分大小写", () => {
    expect(parseCommand("/task list")).toEqual({ ok: true, command: { kind: "task.list" } });
    expect(parseCommand("/TASK LIST")).toEqual({ ok: true, command: { kind: "task.list" } });
    expect(parseCommand("/task T-1")).toEqual({
      ok: true,
      command: { kind: "task.show", taskId: "T-1" },
    });
    expect(parseCommand("/approve T-1")).toEqual({
      ok: true,
      command: { kind: "approve", taskId: "T-1" },
    });
    expect(parseCommand("/resend T-1")).toEqual({
      ok: true,
      command: { kind: "resend", taskId: "T-1" },
    });
  });

  it("reject 保留多词原因", () => {
    expect(parseCommand("/reject T-1 磁盘 已满")).toEqual({
      ok: true,
      command: { kind: "reject", taskId: "T-1", reason: "磁盘 已满" },
    });
    expect(parseCommand("/reject T-1")).toEqual({
      ok: true,
      command: { kind: "reject", taskId: "T-1", reason: undefined },
    });
  });

  it("缺参时给出缺失项与用法", () => {
    expect(parseCommand("/task")).toEqual({
      ok: false,
      reason: "missing",
      missing: ["子命令"],
      usage: "/task list | /task <taskId>",
    });
    expect(parseCommand("/approve")).toMatchObject({
      ok: false,
      reason: "missing",
      missing: ["taskId"],
    });
  });

  it("非斜杠文本与未登记命令一律不支持,不猜意图", () => {
    expect(parseCommand("帮我建个任务")).toEqual({
      ok: false,
      reason: "unsupported",
      received: "帮我建个任务",
    });
    expect(parseCommand("/deploy T-1")).toMatchObject({ ok: false, reason: "unsupported" });
    expect(parseCommand("/task list extra")).toMatchObject({ ok: false, reason: "unsupported" });
    expect(parseCommand("   ")).toEqual({ ok: false, reason: "empty" });
    expect(parseCommand(undefined)).toEqual({ ok: false, reason: "empty" });
  });

  it("非法 taskId 与多余参数被拒", () => {
    expect(parseCommand("/task bad/id")).toMatchObject({ ok: false, reason: "invalid" });
    expect(parseCommand("/approve T-1 extra")).toMatchObject({
      ok: false,
      reason: "invalid",
      detail: "多余参数",
    });
    expect(parseCommand(`/task ${"a".repeat(65)}`)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });
});
