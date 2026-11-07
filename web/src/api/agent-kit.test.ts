import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAgentKit } from "./agent-kit.js";

describe("Agent 接入材料 API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("读指南接口并原样带回规范、skill、提示词与对外地址", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        guide: "规范正文",
        skill: "SKILL 正文",
        prompts: { receiver: "接收侧", senderTemplate: "发起侧" },
        publicUrl: "https://aw.example.com",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const kit = await fetchAgentKit();

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/agent-kit/guide");
    expect(kit.guide).toBe("规范正文");
    expect(kit.prompts.receiver).toBe("接收侧");
    expect(kit.publicUrl).toBe("https://aw.example.com");
  });
});
