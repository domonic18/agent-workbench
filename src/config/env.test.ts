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
    });
  });

  it("端口从字符串转数字", () => {
    expect(loadConfig({ PORT: "9000" }).port).toBe(9000);
  });

  it("非法端口启动即失败,不静默回退", () => {
    expect(() => loadConfig({ PORT: "0" })).toThrow(/端口|PORT/);
    expect(() => loadConfig({ LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });
});
