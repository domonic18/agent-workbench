import { describe, expect, it } from "vitest";
import { PIX_PACKS, PROP_IDS, packOf, propOf } from "./clip-map.js";

describe("角色与道具分配", () => {
  it("同一个 Agent 永远拿到同一套素材", () => {
    expect(packOf("agt_a")).toBe(packOf("agt_a"));
    expect(propOf("agt_a")).toBe(propOf("agt_a"));
  });

  it("素材包落在已登记的六套里", () => {
    for (const id of ["agt_a", "agt_b", "agt_c", "agt_d", "agt_e"]) {
      expect(PIX_PACKS).toContain(packOf(id));
    }
  });

  it("桌面小物要么是已登记的三件，要么留空", () => {
    for (const id of ["agt_a", "agt_b", "agt_c", "agt_d", "agt_e", "agt_f"]) {
      const prop = propOf(id);
      expect(prop === null || PROP_IDS.includes(prop)).toBe(true);
    }
  });
});
