import { describe, expect, it } from "vitest";
import {
  ACTOR_H,
  COLS,
  DESK_W,
  layoutGroups,
  PROPS,
  PROP_BASE_Y,
  STATION,
} from "./geometry.js";

describe("办公室场景布局", () => {
  it("同一台机器的工位挨在一起，不被别的机器插进来", () => {
    const layout = layoutGroups([2, 3, 1]);

    expect(layout.placed.map((item) => item.group)).toEqual([0, 0, 1, 1, 1, 2]);
  });

  it("一行放不下时整组挪到下一行", () => {
    const layout = layoutGroups([4, 4]);

    const rows = new Map<number, number[]>();
    for (const item of layout.placed) {
      rows.set(item.slot.row, [...(rows.get(item.slot.row) ?? []), item.group]);
    }

    expect(rows.get(0)).toEqual([0, 0, 0, 0]);
    expect(rows.get(1)).toEqual([1, 1, 1, 1]);
  });

  it("单组超过一行容量时允许跨行拆开", () => {
    const layout = layoutGroups([COLS + 2]);

    const rows = new Set(layout.placed.map((item) => item.slot.row));

    expect(rows.size).toBe(2);
    expect(layout.placed).toHaveLength(COLS + 2);
  });

  it("行数超出房间容量时整层等比缩小", () => {
    const layout = layoutGroups([COLS, COLS, COLS]);

    expect(layout.rows).toBe(3);
    expect(layout.scale).toBeLessThan(1);
    expect(layout.origin.y).toBeGreaterThan(0);
  });

  it("名牌与用量徽标都排在脚底下方，分区标签排在头顶上方", () => {
    expect(STATION.label.y).toBeGreaterThan(STATION.feet.y);
    expect(STATION.badge.y).toBeGreaterThan(STATION.label.y);
    expect(STATION.zone.y).toBeLessThan(STATION.feet.y);
  });

  it("气泡挂在头顶上方，不压到角色", () => {
    // 气泡底边落在头顶上沿之上，分区标签的基准锚点又在气泡之上
    expect(STATION.bubble.y).toBeLessThan(STATION.feet.y - ACTOR_H);
    expect(STATION.zone.y).toBeLessThan(STATION.bubble.y);
  });

  it("桌面小物落在桌面右侧空位，且不越出桌宽", () => {
    for (const prop of Object.values(PROPS)) {
      expect(prop.x + prop.w).toBeLessThanOrEqual(DESK_W);
      expect(prop.y + prop.h).toBeLessThanOrEqual(PROP_BASE_Y);
    }
  });
});
