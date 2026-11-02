import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

  it("AW_UPSTREAMS 缺省或空数组时只挂原生工具", () => {
    const { AW_UPSTREAMS: _omit, ...rest } = env();
    expect(loadProxyConfig(rest).upstreams).toEqual([]);
    expect(loadProxyConfig(env({ AW_UPSTREAMS: "[]" })).upstreams).toEqual([]);
  });
});

describe("loadProxyConfig 的飞书凭据", () => {
  it("两者都配置时启用协作通知", () => {
    const config = loadProxyConfig(env({ FEISHU_APP_ID: "cli_x", FEISHU_APP_SECRET: "s3cret" }));
    expect(config.feishu).toEqual({ appId: "cli_x", appSecret: "s3cret" });
    expect(config.feishuSource).toBe("env");
  });

  it("缺省或只有空白时关闭协作通知", () => {
    expect(loadProxyConfig(env()).feishu).toBeUndefined();
    expect(loadProxyConfig(env({ FEISHU_APP_ID: " ", FEISHU_APP_SECRET: "" })).feishu).toBeUndefined();
  });

  it("只配置一侧启动失败", () => {
    expect(() => loadProxyConfig(env({ FEISHU_APP_ID: "cli_x" }))).toThrow(/FEISHU_APP_SECRET/);
    expect(() => loadProxyConfig(env({ FEISHU_APP_SECRET: "s3cret" }))).toThrow(/FEISHU_APP_ID/);
  });
});

describe("loadProxyConfig 的 cc-connect 自动发现", () => {
  const dirs: string[] = [];

  function ccConfig(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "cc-config-"));
    dirs.push(dir);
    const path = join(dir, "config.toml");
    writeFileSync(path, content, "utf8");
    return path;
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const CONFIG = `
[[projects]]
name = "agent-sims"

[[projects.platforms]]
type = "feishu"

[projects.platforms.options]
app_id = "cli_cc"
app_secret = "cc-secret"
`;

  it("无显式凭据时按 AW_PROJECT 从 cc-connect 解析", () => {
    const config = loadProxyConfig(
      env({ AW_PROJECT: "agent-sims", FEISHU_CC_CONFIG: ccConfig(CONFIG) }),
    );
    expect(config.feishu).toEqual({ appId: "cli_cc", appSecret: "cc-secret" });
    expect(config.feishuSource).toBe("cc-config");
  });

  it("显式 env 凭据优先于 cc-connect", () => {
    const config = loadProxyConfig(
      env({
        AW_PROJECT: "agent-sims",
        FEISHU_CC_CONFIG: ccConfig(CONFIG),
        FEISHU_APP_ID: "cli_env",
        FEISHU_APP_SECRET: "env-secret",
      }),
    );
    expect(config.feishu).toEqual({ appId: "cli_env", appSecret: "env-secret" });
    expect(config.feishuSource).toBe("env");
  });

  it("没有 AW_PROJECT 时静默关闭通知", () => {
    const config = loadProxyConfig(env({ FEISHU_CC_CONFIG: ccConfig(CONFIG) }));
    expect(config.feishu).toBeUndefined();
    expect(config.feishuWarning).toBeUndefined();
  });

  it("项目或配置缺失时给出 warning 且关闭通知", () => {
    const missingProject = loadProxyConfig(
      env({ AW_PROJECT: "nope", FEISHU_CC_CONFIG: ccConfig(CONFIG) }),
    );
    expect(missingProject.feishu).toBeUndefined();
    expect(missingProject.feishuWarning).toContain("找不到项目 nope");

    const missingFile = loadProxyConfig(
      env({ AW_PROJECT: "agent-sims", FEISHU_CC_CONFIG: "/nonexistent/cc.toml" }),
    );
    expect(missingFile.feishu).toBeUndefined();
    expect(missingFile.feishuWarning).toContain("无法读取");
  });
});
