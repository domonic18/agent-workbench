import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "../../api/identity.js";
import { DelegationCanvas } from "./DelegationCanvas.js";
import { layoutGraph } from "./layout.js";

function agent(id: string, name: string): AgentSummary {
  return {
    id,
    machineId: null,
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
  };
}

const AGENTS = [agent("agt_a", "甲"), agent("agt_b", "乙")];

function renderCanvas(overrides: Partial<Parameters<typeof DelegationCanvas>[0]> = {}) {
  const onToggleTarget = vi.fn();
  const onSelect = vi.fn();
  render(
    <DelegationCanvas
      agents={AGENTS}
      groups={[]}
      selection={{}}
      selectedId={null}
      onSelect={onSelect}
      onToggleTarget={onToggleTarget}
      {...overrides}
    />,
  );
  return { onToggleTarget, onSelect };
}

describe("委派画布", () => {
  afterEach(() => {
    cleanup();
  });

  it("节点可读、可聚焦(键盘可达)", () => {
    renderCanvas();

    const hit = screen.getByRole("button", { name: /甲/ });
    expect(hit.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(hit);
    expect(screen.getByRole("button", { name: /甲/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("滚轮缩放改变缩放比例", () => {
    renderCanvas();
    const canvas = screen.getByTestId("delegation-canvas");

    fireEvent.wheel(canvas, { deltaY: -100, clientX: 10, clientY: 10 });

    expect(screen.getByText("125%")).toBeTruthy();
  });

  it("拖空白平移画布", () => {
    renderCanvas();
    const canvas = screen.getByTestId("delegation-canvas");

    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 45, clientY: 25, button: 0 });
    fireEvent.pointerUp(canvas, { clientX: 45, clientY: 25, button: 0 });

    // 平移后缩放比例不变,画布仍在
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("从节点手柄拖到目标节点即建立委派", () => {
    const { onToggleTarget } = renderCanvas();
    const canvas = screen.getByTestId("delegation-canvas");
    const handle = canvas.querySelector('[data-handle="1"][data-node-key="agt_a"]');
    if (handle === null) throw new Error("没有连接手柄");

    const layout = layoutGraph(AGENTS);
    const target = layout.nodes.find((node) => node.key === "agt_b");
    if (target === undefined) throw new Error("没有目标节点");

    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: target.x + 10, clientY: target.y + 10, button: 0 });
    fireEvent.pointerUp(canvas, { clientX: target.x + 10, clientY: target.y + 10, button: 0 });

    expect(onToggleTarget).toHaveBeenCalledWith("agt_a", "agt_b");
  });

  it("拖到空白处不建立委派", () => {
    const { onToggleTarget } = renderCanvas();
    const canvas = screen.getByTestId("delegation-canvas");
    const handle = canvas.querySelector('[data-handle="1"][data-node-key="agt_a"]');
    if (handle === null) throw new Error("没有连接手柄");

    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 9999, clientY: 9999, button: 0 });
    fireEvent.pointerUp(canvas, { clientX: 9999, clientY: 9999, button: 0 });

    expect(onToggleTarget).not.toHaveBeenCalled();
  });
});
