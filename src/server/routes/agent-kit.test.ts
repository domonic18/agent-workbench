import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "secret123";

function cookieOf(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    throw new Error("响应没有 set-cookie");
  }
  return value.split(";")[0] as string;
}

describe("Agent 接入材料路由", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    db = await openDatabase();
    await ensureConsoleCredential(db, PASSWORD);
    app = buildApp({
      logLevel: "silent",
      db,
      knowledgeDir: mkdtempSync(join(tmpdir(), "aw-kit-")),
      publicUrl: "https://aw.example.com",
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    cookie = cookieOf(login);
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  it("未登录读指南 401", async () => {
    const response = await app.inject({ method: "GET", url: "/api/agent-kit/guide" });
    expect(response.statusCode).toBe(401);
  });

  it("指南含规范正文、skill 与工作区提示词", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/agent-kit/guide",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      guide: string;
      skill: string;
      prompts: { receiver: string; senderTemplate: string };
      publicUrl: string | null;
    };
    expect(body.guide).toContain("## 五、接收侧六步");
    expect(body.guide).toContain("https://aw.example.com/mcp");
    expect(body.guide).toContain("| `a2a_guide` | L0 |");
    expect(body.skill.startsWith("---\nname: aw-a2a\n")).toBe(true);
    expect(body.prompts.receiver).toContain("a2a_inbox");
    expect(body.prompts.senderTemplate).toContain("a2a_send");
    expect(body.publicUrl).toBe("https://aw.example.com");
  });

  it("skill 以附件下载", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/agent-kit/skill",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/markdown");
    expect(response.headers["content-disposition"]).toContain("SKILL.md");
    expect(response.body.startsWith("---\nname: aw-a2a\n")).toBe(true);
  });
});
