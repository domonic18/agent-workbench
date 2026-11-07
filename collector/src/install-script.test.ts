import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/install-aw-node.sh");

function dryRun(stateDir: string): string {
  const result = spawnSync(
    "sh",
    [SCRIPT, "--dry-run", "--url", "https://aw.example.com", "--state-dir", stateDir],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  return result.stdout;
}

describe("install-aw-node.sh 模式判定", () => {
  it("本机无凭据时走首次加入,需要一次性 token", () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-node-mode-"));
    expect(dryRun(dir)).toContain("模式:首次加入");
  });

  it("本机已有凭据时走覆盖安装,不需要 token", () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-node-mode-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "credentials.json"), "{}");
    expect(dryRun(dir)).toContain("模式:覆盖安装");
  });

  it("显式 --mode upgrade 时不看凭据也走覆盖安装", () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-node-mode-"));
    const result = spawnSync(
      "sh",
      [
        SCRIPT,
        "--dry-run",
        "--mode",
        "upgrade",
        "--url",
        "https://aw.example.com",
        "--state-dir",
        dir,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("模式:覆盖安装");
  });

  it("未知 --mode 直接报错退出", () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-node-mode-"));
    const result = spawnSync(
      "sh",
      [SCRIPT, "--dry-run", "--mode", "bogus", "--url", "https://aw.example.com", "--state-dir", dir],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("未知 --mode");
  });
});
