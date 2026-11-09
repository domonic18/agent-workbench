import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claudeProjectDir,
  resolveSessionActivity,
  sampleSessionFiles,
  type SessionSample,
} from "./session-activity.js";

const dirs: string[] = [];

function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aw-session-act-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("claudeProjectDir", () => {
  it("非字母数字一律替换为 -(Claude Code 项目目录映射)", () => {
    expect(claudeProjectDir("/Users/deadwalk/Code/acore-portal")).toBe(
      "-Users-deadwalk-Code-acore-portal",
    );
  });
});

describe("sampleSessionFiles", () => {
  it("只收 projects 下 uuid 命名的 jsonl,键为 <dir>/<name>", () => {
    const root = newDir();
    const proj = join(root, "projects", "-Users-x-proj");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "00000000-0000-0000-0000-000000000000.jsonl"), "{}");
    writeFileSync(join(proj, "not-uuid.jsonl"), "{}");
    writeFileSync(join(proj, "notes.txt"), "{}");

    const sample = sampleSessionFiles(root);
    const key = "-Users-x-proj/00000000-0000-0000-0000-000000000000.jsonl";
    expect([...sample.keys()]).toEqual([key]);
    expect(sample.get(key)).toBeGreaterThan(0);
  });

  it("目录不存在返回空采样,不抛错", () => {
    expect(sampleSessionFiles(join(newDir(), ".claude")).size).toBe(0);
  });
});

describe("resolveSessionActivity", () => {
  const UUID_A = "11111111-1111-1111-1111-111111111111";
  const UUID_B = "22222222-2222-2222-2222-222222222222";
  const key = (dir: string, id: string): string => `${dir}/${id}.jsonl`;

  it("有基线:mtime 较上轮前进才活跃;停写的文件不再活跃", () => {
    const prev: SessionSample = new Map([[key("-Users-x-proj", UUID_A), 900]]);
    const curr: SessionSample = new Map([
      [key("-Users-x-proj", UUID_A), 950],
      [key("-Users-y-proj", UUID_B), 800],
    ]);
    const activity = resolveSessionActivity(prev, curr, 1_000_000, 15 * 60_000);
    expect(activity.activeCount).toBe(1);
    expect(activity.cwdActive("/Users/x/proj")).toBe(true);
    expect(activity.cwdActive("/Users/y/proj")).toBe(false);
  });

  it("无基线(启动首轮):窗口内新出现的文件兜底判活跃,超窗口不算", () => {
    const now = 1_000_000;
    const curr: SessionSample = new Map([
      [key("-Users-x-proj", UUID_A), now - 60_000],
      [key("-Users-y-proj", UUID_B), now - 20 * 60_000],
    ]);
    const activity = resolveSessionActivity(undefined, curr, now, 15 * 60_000);
    expect(activity.activeCount).toBe(1);
    expect(activity.cwdActive("/Users/x/proj")).toBe(true);
    expect(activity.cwdActive("/Users/y/proj")).toBe(false);
  });

  it("同一目录多文件任一在写即该 cwd 活跃", () => {
    const prev: SessionSample = new Map([
      [key("-Users-x-proj", UUID_A), 900],
      [key("-Users-x-proj", UUID_B), 900],
    ]);
    const curr: SessionSample = new Map([
      [key("-Users-x-proj", UUID_A), 900],
      [key("-Users-x-proj", UUID_B), 901],
    ]);
    const activity = resolveSessionActivity(prev, curr, 1_000_000, 15 * 60_000);
    expect(activity.activeCount).toBe(1);
    expect(activity.cwdActive("/Users/x/proj")).toBe(true);
  });
});
