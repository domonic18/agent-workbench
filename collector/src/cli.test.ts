import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnosticsEnv } from "./cli.js";

const PREV_URL = process.env.AW_INGEST_URL;

afterEach(() => {
  if (PREV_URL === undefined) {
    delete process.env.AW_INGEST_URL;
  } else {
    process.env.AW_INGEST_URL = PREV_URL;
  }
});

function plist(env: Record<string, string>): string {
  const entries = Object.entries(env)
    .map(([key, value]) => `    <key>${key}</key><string>${value}</string>`)
    .join("\n");
  return `<plist><dict>
  <key>EnvironmentVariables</key>
  <dict>
${entries}
  </dict>
</dict></plist>`;
}

describe("diagnosticsEnv", () => {
  it("进程 env 没有控制台地址时回退到已安装服务的 plist", () => {
    delete process.env.AW_INGEST_URL;
    const dir = mkdtempSync(join(tmpdir(), "aw-node-plist-"));
    const file = join(dir, "aw-node.plist");
    writeFileSync(
      file,
      plist({ AW_INGEST_URL: "https://aw.example.com", AW_CLAUDE_DIR: "/Users/t/.claude" }),
    );

    const env = diagnosticsEnv(file);

    expect(env.AW_INGEST_URL).toBe("https://aw.example.com");
    expect(env.AW_CLAUDE_DIR).toBe("/Users/t/.claude");
  });

  it("进程 env 显式给了就以进程 env 为准", () => {
    process.env.AW_INGEST_URL = "http://127.0.0.1:9999";
    const dir = mkdtempSync(join(tmpdir(), "aw-node-plist-"));
    const file = join(dir, "aw-node.plist");
    writeFileSync(file, plist({ AW_INGEST_URL: "https://aw.example.com" }));

    expect(diagnosticsEnv(file).AW_INGEST_URL).toBe("http://127.0.0.1:9999");
  });

  it("plist 不存在时退回进程 env,不报错", () => {
    process.env.AW_INGEST_URL = "http://127.0.0.1:9999";
    const dir = mkdtempSync(join(tmpdir(), "aw-node-plist-"));
    expect(diagnosticsEnv(join(dir, "missing.plist")).AW_INGEST_URL).toBe("http://127.0.0.1:9999");
  });
});
