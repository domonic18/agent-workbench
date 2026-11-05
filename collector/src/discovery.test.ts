import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG_CANDIDATES,
  feishuCredentialsOf,
  projectToReport,
  resolveConfigPaths,
  scanDiscovery,
  scanDiscoveryState,
} from "./discovery.js";

const dirs: string[] = [];

function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aw-disc-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const SAMPLE = `
[[projects]]
name = "bug-triage"
admin_from = "*"

  [projects.agent]
  type = "claudecode"
  [projects.agent.options]
  allowed_tools = ["Bash"]
  work_dir = "/Users/x/Workspace/bug-triage"

  [projects.agent.options.env]
  GH_TOKEN = "ghp_should_never_appear"

  [[projects.platforms]]
  type = "feishu"
  [projects.platforms.options]
  app_id = "cli_xxx"
  app_secret = "must_not_leak"
`;

describe("projectToReport", () => {
  it("白名单提取:type/work_dir/platforms;敏感字段不出现在产物", () => {
    const report = projectToReport({
      name: "p1",
      agent: { type: "claudecode", options: { work_dir: "/w/p1" } },
      platforms: [{ type: "feishu" }],
    });
    expect(report).toEqual({
      name: "p1",
      cwd: "/w/p1",
      agents: [{ type: "claudecode" }],
      channels: [{ type: "feishu" }],
    });
    expect(JSON.stringify(report)).not.toContain("feishu_app");
  });

  it("providers.models 的 alias 收进 agents.models", () => {
    const report = projectToReport({
      name: "p2",
      agent: {
        type: "claudecode",
        providers: [{ models: [{ alias: "sonnet" }, { alias: "opus" }, { name: "no-alias" }] }],
      },
    });
    expect(report?.agents).toEqual([{ type: "claudecode", models: ["sonnet", "opus"] }]);
  });

  it("缺名字或空名返回 null", () => {
    expect(projectToReport({ agent: { type: "claudecode" } })).toBeNull();
    expect(projectToReport({ name: "  " })).toBeNull();
  });
});

describe("scanDiscovery", () => {
  it("解析真实形态配置,敏感字段不进入报告,结果按名排序", () => {
    const dir = newDir();
    const path = join(dir, "config.toml");
    writeFileSync(path, SAMPLE);
    const report = scanDiscovery([path]);
    expect(report.projects).toEqual([
      {
        name: "bug-triage",
        cwd: "/Users/x/Workspace/bug-triage",
        agents: [{ type: "claudecode" }],
        channels: [{ type: "feishu" }],
      },
    ]);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("ghp_should_never_appear");
    expect(serialized).not.toContain("must_not_leak");
    expect(serialized).not.toContain("cli_xxx");
  });

  it("多路径按项目名合并,带 cwd 的条目优先", () => {
    const dirA = newDir();
    const dirB = newDir();
    writeFileSync(join(dirA, "a.toml"), '[[projects]]\nname = "p1"\n');
    writeFileSync(
      join(dirB, "b.toml"),
      '[[projects]]\nname = "p1"\n[projects.agent.options]\nwork_dir = "/w/p1"\n',
    );
    writeFileSync(join(dirB, "b.toml.bak"), "ignored");
    const report = scanDiscovery([join(dirA, "a.toml"), join(dirB, "b.toml")]);
    expect(report.projects).toEqual([{ name: "p1", cwd: "/w/p1", agents: [{}], channels: [] }]);
  });

  it("路径不存在或配置损坏时返回空列表,不抛错", () => {
    expect(scanDiscovery([join(newDir(), "none.toml")]).projects).toEqual([]);
    const dir = newDir();
    const path = join(dir, "broken.toml");
    writeFileSync(path, "not [ valid toml");
    expect(scanDiscovery([path]).projects).toEqual([]);
  });

  it("空数组与 undefined 同义回退默认候选路径(loadConfig 未设 AW_CC_CONNECT_CONFIG 时给出空数组)", () => {
    expect(resolveConfigPaths()).toEqual(DEFAULT_CONFIG_CANDIDATES);
    expect(resolveConfigPaths([])).toEqual(DEFAULT_CONFIG_CANDIDATES);
    expect(resolveConfigPaths(["/custom/config.toml"])).toEqual(["/custom/config.toml"]);
  });

  it("feishuCredentialsOf 提取应用凭据,但凭据不随 report 序列化", () => {
    const cred = feishuCredentialsOf({
      name: "bug-triage",
      platforms: [{ type: "feishu", options: { app_id: "cli_xxx", app_secret: "must_not_leak" } }],
    });
    expect(cred).toEqual({ appId: "cli_xxx", appSecret: "must_not_leak" });
    expect(feishuCredentialsOf({ name: "p", platforms: [{ type: "other" }] })).toBeUndefined();
    expect(feishuCredentialsOf({ name: "p", platforms: [{ type: "feishu" }] })).toBeUndefined();
  });

  it("scanDiscoveryState 返回 report 与本地凭据映射,凭据不进 report", () => {
    const dir = newDir();
    const path = join(dir, "config.toml");
    writeFileSync(path, SAMPLE);
    const { report, feishuCredentials } = scanDiscoveryState([path]);
    expect(report.projects[0]).toEqual({
      name: "bug-triage",
      cwd: "/Users/x/Workspace/bug-triage",
      agents: [{ type: "claudecode" }],
      channels: [{ type: "feishu" }],
    });
    expect(feishuCredentials.get("bug-triage")).toEqual({ appId: "cli_xxx", appSecret: "must_not_leak" });
    expect(JSON.stringify(report)).not.toContain("must_not_leak");
    expect(JSON.stringify(report)).not.toContain("cli_xxx");
  });
});
