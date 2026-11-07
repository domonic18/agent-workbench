import { describe, expect, it } from "vitest";
import { TOOL_GATE } from "../../shared/constants.js";
import type { AgentRecord } from "../../store/repositories/agent.js";
import type { ConsoleToolDeps } from "../console-shared.js";
import { createGuideTools } from "./guide-tool.js";

describe("a2a_guide 工具", () => {
  it("是 L0 只读工具且闸门已登记", () => {
    const [tool] = createGuideTools({} as ConsoleToolDeps);
    expect(tool?.name).toBe("a2a_guide");
    expect(tool?.gateName).toBe("guide.read");
    expect(TOOL_GATE.l0).toContain("guide.read");
    expect(tool?.auditTaskId({})).toBeNull();
  });

  it("返回规范正文且不牵涉任何身份", async () => {
    const [tool] = createGuideTools({} as ConsoleToolDeps);
    const result = await tool?.execute({} as AgentRecord, {});
    const first = result?.content[0];
    expect(first?.type).toBe("text");
    const payload = JSON.parse(first?.type === "text" ? first.text : "{}") as {
      guide: string;
      hint: string;
    };
    expect(payload.guide).toContain("接收侧六步");
    expect(payload.guide).toContain("回执纪律");
    expect(payload.hint).toContain("tools/list");
  });
});
