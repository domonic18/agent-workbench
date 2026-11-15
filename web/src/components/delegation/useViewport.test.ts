import { describe, expect, it } from "vitest";
import { fitViewport, toGraph, zoomAt, INITIAL_VIEWPORT } from "./useViewport.js";

describe("画布视口", () => {
  it("以锚点缩放:锚点下的图形位置不动", () => {
    const viewport = { scale: 1, x: 0, y: 0 };
    const anchor = { x: 400, y: 300 };
    const before = toGraph(anchor.x, anchor.y, viewport);

    const next = zoomAt(viewport, 2, anchor.x, anchor.y);
    const after = toGraph(anchor.x, anchor.y, next);

    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(next.scale).toBe(2);
  });

  it("缩放有上下限", () => {
    expect(zoomAt(INITIAL_VIEWPORT, 99, 0, 0).scale).toBeLessThanOrEqual(2.5);
    expect(zoomAt(INITIAL_VIEWPORT, 0.01, 0, 0).scale).toBeGreaterThanOrEqual(0.25);
  });

  it("适应容器:整张图缩到容器内并居中", () => {
    const viewport = fitViewport(400, 300, 800, 600);

    expect(viewport.scale).toBeCloseTo(0.5, 5);
    expect(viewport.x).toBeCloseTo(0, 5);
    expect(viewport.y).toBeCloseTo(0, 5);
  });

  it("图比容器小就按 1:1 放,不留多余缩放", () => {
    expect(fitViewport(800, 600, 400, 300).scale).toBe(1);
  });
});
