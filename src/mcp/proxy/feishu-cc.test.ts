import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { locateCcConfig, readFeishuCredentials } from "./feishu-cc.js";

const dirs: string[] = [];

function writeConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cc-"));
  dirs.push(dir);
  const path = join(dir, "config.toml");
  writeFileSync(path, content, "utf8");
  return path;
}

/** 造一份 home 目录下的默认候选路径配置 */
function writeHomeConfig(content: string): { home: string; path: string } {
  const home = mkdtempSync(join(tmpdir(), "cc-home-"));
  dirs.push(home);
  const dir = join(home, ".config", "cc-connect");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "config.toml");
  writeFileSync(path, content, "utf8");
  return { home, path };
}

const CONFIG = `
[[projects]]
name = "agent-sims"

[[projects.platforms]]
type = "feishu"

[projects.platforms.options]
app_id = "cli_a"
app_secret = "secret-a"

[[projects]]
name = "other"

[[projects.platforms]]
type = "feishu"

[projects.platforms.options]
app_id = "cli_b"
app_secret = "secret-b"
`;

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("locateCcConfig", () => {
  it("显式 FEISHU_CC_CONFIG 优先于默认路径", () => {
    const path = writeConfig(CONFIG);
    expect(locateCcConfig({ FEISHU_CC_CONFIG: ` ${path} ` }, "/nonexistent")).toBe(path);
  });

  it("未显式配置时按顺序取首个存在的候选路径", () => {
    const { path } = writeHomeConfig(CONFIG);
    expect(locateCcConfig({}, "/unused", ["/nonexistent/cc.toml", path])).toBe(path);
  });

  it("候选路径都不存在时返回 undefined", () => {
    expect(
      locateCcConfig({}, "/nonexistent-home", ["/nonexistent/a.toml", "/nonexistent/b.toml"]),
    ).toBeUndefined();
  });
});

describe("readFeishuCredentials", () => {
  it("按项目名取对应 feishu 平台的凭据", () => {
    const path = writeConfig(CONFIG);
    expect(readFeishuCredentials(path, "agent-sims")).toEqual({
      credentials: { appId: "cli_a", appSecret: "secret-a" },
    });
    expect(readFeishuCredentials(path, "other")).toEqual({
      credentials: { appId: "cli_b", appSecret: "secret-b" },
    });
  });

  it("项目不存在时返回原因而非抛错", () => {
    const path = writeConfig(CONFIG);
    const result = readFeishuCredentials(path, "missing");
    expect(result.credentials).toBeUndefined();
    expect(result.reason).toContain("找不到项目 missing");
  });

  it("项目没有 feishu 平台时返回原因", () => {
    const path = writeConfig(`
[[projects]]
name = "agent-sims"

[[projects.platforms]]
type = "slack"

[projects.platforms.options]
token = "x"
`);
    const result = readFeishuCredentials(path, "agent-sims");
    expect(result.credentials).toBeUndefined();
    expect(result.reason).toContain("没有 feishu 平台");
  });

  it("缺少 app_secret 时返回原因且不泄漏其他凭据", () => {
    const path = writeConfig(`
[[projects]]
name = "agent-sims"

[[projects.platforms]]
type = "feishu"

[projects.platforms.options]
app_id = "cli_a"
`);
    const result = readFeishuCredentials(path, "agent-sims");
    expect(result.credentials).toBeUndefined();
    expect(result.reason).toContain("缺少 app_id/app_secret");
  });

  it("文件不存在或不是合法 TOML 时降级为原因", () => {
    expect(readFeishuCredentials("/nonexistent/config.toml", "p").reason).toContain(
      "无法读取",
    );
    const bad = writeConfig("[[projects");
    expect(readFeishuCredentials(bad, "p").reason).toContain("不是合法 TOML");
  });
});
