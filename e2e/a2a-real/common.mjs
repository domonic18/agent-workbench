// A2A 真机实测共用件:控制台会话、HTTP 调用、库取证、接入包读写
//
// 被测链路(A2A 本身)走 Agent Bearer;这里的控制台会话只用于「装配」:
// 注册 Agent、签发 enroll token、配委派白名单。
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const base = (process.env.AW_A2A_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
/** 外部运行时(MacBook / WorkBuddy)可达的公网控制台地址;仓库公开,真实域名只走 env */
export const publicUrl = (process.env.AW_A2A_PUBLIC_URL ?? "https://aw.example.com").replace(/\/$/, "");
export const pgContainer = process.env.AW_A2A_PG_CONTAINER ?? "agent-workbench-postgres-1";
export const outDir = join(here, "out");
export const passwordFile = join(here, ".console-password");
/** 本机 aw-node 的配置状态:机器绑定 Agent 的工作目录与 Bearer 来源 */
export const configStatePath = join(
  process.env.HOME ?? "/tmp",
  ".aw-node",
  "config-state.json",
);

export function ok(label, detail) {
  console.log(`PASS ${label}${detail === undefined ? "" : ` :: ${detail}`}`);
}

export function fail(label, detail) {
  console.log(`FAIL ${label}${detail === undefined ? "" : ` :: ${detail}`}`);
  process.exitCode = 1;
}

export function assert(cond, label, detail) {
  if (cond) {
    ok(label, detail);
  } else {
    fail(label, detail);
  }
  return cond;
}

export async function api(path, { method = "GET", cookie, body, key, bearer } = {}) {
  // content-type 只在有 body 时带:无 body 的 POST 带 json 头会被 Fastify 400
  const headers = {};
  if (cookie !== undefined) headers.cookie = cookie;
  if (bearer !== undefined) headers.authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["x-requested-with"] = "fetch";
  if (key !== undefined) headers["idempotency-key"] = key;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    headers: res.headers,
    body: await res.json().catch(() => null),
  };
}

export function psql(sql) {
  return execFileSync(
    "docker",
    [
      "exec",
      pgContainer,
      "psql",
      "-U",
      "agent_workbench",
      "-d",
      "agent_workbench",
      "-tAc",
      sql,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

/**
 * 以 JSON 行取数:每行一个对象,列名即键。
 * 子查询不能带分号——整条语句由本函数拼装。
 */
export function query(sql) {
  const out = psql(`SELECT row_to_json(t) FROM (${sql}) t`);
  if (out === "") {
    return [];
  }
  return out.split("\n").map((line) => JSON.parse(line));
}

/** Agent Bearer 是否仍然有效:向 /mcp 发一次 initialize */
export async function mcpAlive(bearer, url = base) {
  try {
    const res = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "a2a-real-probe", version: "0.0.1" },
        },
      }),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

export function writeBundle(name, payload) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(payload, null, 2), { mode: 0o600 });
}

/** 接入材料正文(含一次性令牌等敏感值),同样只落 gitignore 的 out/ */
export function writeText(name, text) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${name}.txt`), text, { mode: 0o600 });
}

export function readBundle(name) {
  const path = join(outDir, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(`缺少接入包 ${path};先跑 prepare.mjs`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function consolePassword() {
  const fromEnv = process.env.AW_A2A_PASSWORD;
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }
  if (existsSync(passwordFile)) {
    const value = readFileSync(passwordFile, "utf8").trim();
    return value === "" ? null : value;
  }
  return null;
}

/**
 * 控制台会话:有口令走真实登录;无口令时本地直签一条会话。
 * 直签只用于装配(注册 Agent / 签 enroll token / 配白名单),不影响被测的 Agent Bearer 链路。
 */
export async function consoleSession() {
  const password = consolePassword();
  if (password !== null) {
    const login = await api("/api/auth/login", { method: "POST", body: { password } });
    if (login.status !== 200) {
      throw new Error(`控制台登录失败 status=${login.status}`);
    }
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    if (cookie === undefined) {
      throw new Error("控制台登录响应没有 set-cookie");
    }
    return { cookie, source: "login" };
  }
  const id = randomBytes(24).toString("base64url");
  const now = Date.now();
  psql(
    `INSERT INTO session (id, created_at, last_seen_at, expires_at) VALUES ('${id}', ${now}, ${now}, ${now + 3600000})`,
  );
  return { cookie: `aw_session=${id}`, source: "local-mint" };
}

/** 本机机器绑定 Agent 的工作目录(来自 aw-node 配置状态) */
export function localAgentCwd(agentId) {
  if (!existsSync(configStatePath)) {
    return undefined;
  }
  const state = JSON.parse(readFileSync(configStatePath, "utf8"));
  return state.agents?.[agentId]?.cwd;
}
