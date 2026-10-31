import { describe, expect, it } from "vitest";
import { loadProxyConfig } from "./config.js";

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    AW_RUN_ID: "run_1",
    AW_AGENT_ID: "agt_1",
    AW_AGENT_SECRET: "secret-1",
    AW_TASK_ID: "T-1",
    AW_WORKSPACE_ROOT: "/workspace",
    AW_UPSTREAMS: JSON.stringify([{ id: "fs", command: "npx" }]),
    ...overrides,
  };
}

describe("loadProxyConfig 的 AW_GRANTS 解析", () => {
  it("解析逗号分隔的 tool:capabilityId 对", () => {
    const config = loadProxyConfig(env({ AW_GRANTS: "fs.read:cap_1, fs.exec:cap_2" }));
    expect(config.ctx.grants).toEqual([
      { tool: "fs.read", capabilityId: "cap_1" },
      { tool: "fs.exec", capabilityId: "cap_2" },
    ]);
  });

  it("未设置或只有空条目时为空数组", () => {
    expect(loadProxyConfig(env()).ctx.grants).toEqual([]);
    expect(loadProxyConfig(env({ AW_GRANTS: " , " })).ctx.grants).toEqual([]);
  });

  it("缺少冒号或任一侧为空时报错", () => {
    expect(() => loadProxyConfig(env({ AW_GRANTS: "fs.read" }))).toThrow(/tool:capabilityId/);
    expect(() => loadProxyConfig(env({ AW_GRANTS: "fs.read:" }))).toThrow(/tool:capabilityId/);
    expect(() => loadProxyConfig(env({ AW_GRANTS: ":cap_1" }))).toThrow(/tool:capabilityId/);
  });

  it("同一工具重复出现时报错", () => {
    expect(() => loadProxyConfig(env({ AW_GRANTS: "fs.read:cap_1,fs.read:cap_2" }))).toThrow(
      /重复工具/,
    );
  });
});

describe("loadProxyConfig 的控制台触达配置", () => {
  it("CONSOLE_URL 缺省指向本机控制台", () => {
    const config = loadProxyConfig(env());
    expect(config.consoleBaseUrl).toBe("http://127.0.0.1:8787");
    expect(config.agentSecret).toBe("secret-1");
  });

  it("CONSOLE_URL 可覆盖,非法 URL 启动失败", () => {
    expect(loadProxyConfig(env({ CONSOLE_URL: "http://console.test:9000" })).consoleBaseUrl).toBe(
      "http://console.test:9000",
    );
    expect(() => loadProxyConfig(env({ CONSOLE_URL: "not-a-url" }))).toThrow(/CONSOLE_URL/);
  });

  it("缺 AW_AGENT_SECRET 启动失败", () => {
    const { AW_AGENT_SECRET: _omit, ...rest } = env();
    expect(() => loadProxyConfig(rest)).toThrow(/AW_AGENT_SECRET/);
  });
});
