import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.js";

describe("loadConfig", () => {
  it("空环境下给出一期默认值", () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: "development",
      logLevel: "info",
      host: "127.0.0.1",
      port: 8787,
      databasePath: "./workspace/console.db",
      teleport: {
        tctlPath: "tctl",
        identityFile: undefined,
        botRole: "aw-ext",
        botMaxSessionTtl: "12h",
      },
    });
  });

  it("端口从字符串转数字", () => {
    expect(loadConfig({ PORT: "9000" }).port).toBe(9000);
  });

  it("非法端口启动即失败,不静默回退", () => {
    expect(() => loadConfig({ PORT: "0" })).toThrow(/端口|PORT/);
    expect(() => loadConfig({ LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });

  it("初始化口令空串视为未设置", () => {
    expect(loadConfig({ CONSOLE_INIT_PASSWORD: "" }).consoleInitPassword).toBeUndefined();
    expect(loadConfig({ CONSOLE_INIT_PASSWORD: "simple-123" }).consoleInitPassword).toBe(
      "simple-123",
    );
  });

  it("未配置飞书凭据时不建立连接配置", () => {
    expect(loadConfig({}).feishu).toBeUndefined();
    expect(loadConfig({ FEISHU_APP_ID: "", FEISHU_APP_SECRET: "" }).feishu).toBeUndefined();
  });

  it("飞书凭据必须成对,单边配置启动即失败", () => {
    expect(() => loadConfig({ FEISHU_APP_ID: "cli_x" })).toThrow(/同时设置/);
    expect(() => loadConfig({ FEISHU_APP_SECRET: "secret" })).toThrow(/同时设置/);
  });

  it("白名单去空白去重,空串视为空清单", () => {
    const base = { FEISHU_APP_ID: "cli_x", FEISHU_APP_SECRET: "secret" };
    expect(loadConfig(base).feishu?.allowedOpenIds).toEqual([]);
    expect(
      loadConfig({
        ...base,
        FEISHU_ALLOWED_OPEN_IDS: " ou_a , ,ou_b,ou_a ",
        FEISHU_VERIFICATION_TOKEN: " ",
      }).feishu,
    ).toEqual({
      appId: "cli_x",
      appSecret: "secret",
      allowedOpenIds: ["ou_a", "ou_b"],
      verificationToken: undefined,
    });
  });
});
