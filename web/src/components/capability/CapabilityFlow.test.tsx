import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CapabilityFlow } from "./CapabilityFlow.js";

function renderFlow(
  overrides: Partial<Parameters<typeof CapabilityFlow>[0]> = {},
): void {
  render(
    <CapabilityFlow
      subject="agent:codex"
      subjectName={null}
      action="read"
      target="db:prod"
      status="pending"
      {...overrides}
    />,
  );
}

describe("能力流程条", () => {
  afterEach(cleanup);

  it("解析名优先,查不到回落 subject 原文", () => {
    renderFlow({ subjectName: "外接机器人" });
    expect(screen.getByText("外接机器人")).toBeTruthy();

    cleanup();
    renderFlow();
    expect(screen.getByText("agent:codex")).toBeTruthy();
  });

  it("动作胶囊同时展示枚举文本与中文注释", () => {
    renderFlow({ action: "write" });
    expect(screen.getByText("write")).toBeTruthy();
    expect(screen.getByText("写入")).toBeTruthy();
    expect(screen.getByText("db:prod")).toBeTruthy();
  });

  it("待批/签发中出现人工闸门,生效态不出现", () => {
    renderFlow({ status: "pending" });
    expect(screen.getByText("待人批准")).toBeTruthy();

    cleanup();
    renderFlow({ status: "issuing" });
    expect(screen.getByText("签发中")).toBeTruthy();

    cleanup();
    renderFlow({ status: "active" });
    expect(screen.queryByText("待人批准")).toBeNull();
    expect(screen.queryByText("签发中")).toBeNull();
  });
});
