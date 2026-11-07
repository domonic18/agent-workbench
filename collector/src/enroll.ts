import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { COLLECTOR_VERSION } from "./config.js";
import type { EnrollRequestBody, EnrollResponseBody } from "../../src/shared/aw-node-wire.js";

export interface EnrollCredentials {
  /** 控制台根地址,如 https://aw.example.com(不带尾斜杠) */
  consoleUrl: string;
  machineId: string;
  secret: string;
}

const CREDENTIALS_FILE = "credentials.json";

export function credentialsPath(stateDir: string): string {
  return join(stateDir, CREDENTIALS_FILE);
}

export function saveCredentials(stateDir: string, credentials: EnrollCredentials): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(credentialsPath(stateDir), JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

export function loadCredentials(stateDir: string): EnrollCredentials | null {
  const path = credentialsPath(stateDir);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<EnrollCredentials>;
    if (
      typeof parsed.consoleUrl === "string" &&
      typeof parsed.machineId === "string" &&
      typeof parsed.secret === "string"
    ) {
      return parsed as EnrollCredentials;
    }
  } catch {
    // 损坏的凭据文件按缺失处理,由 enroll 重建
  }
  return null;
}

async function readAllStdin(input: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    input.setEncoding("utf8");
    input.on("data", (chunk: string) => {
      data += chunk;
    });
    input.on("end", () => {
      resolve(data.trim());
    });
    input.on("error", () => {
      resolve("");
    });
  });
}

/** 交互隐藏输入:prompt 走 stderr,readline 回显被屏蔽,令牌不进终端与 history */
async function promptHidden(prompt: string): Promise<string> {
  process.stderr.write(`${prompt}`);
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  }) as ReturnType<typeof createInterface> & { output: { write: () => boolean } };
  rl.output.write = () => true;
  const answer = await new Promise<string>((resolve) => {
    rl.question("", (value) => {
      resolve(value);
    });
  });
  rl.close();
  process.stderr.write("\n");
  return answer.trim();
}

export interface TokenInput {
  env?: string | undefined;
  stdin?: NodeJS.ReadableStream;
  /** 交互隐藏输入实现,测试注入用;默认走 stderr prompt + 回显屏蔽 */
  prompt?: (prompt: string) => Promise<string>;
}

/**
 * enroll token 获取顺序:环境变量 AW_ENROLL_TOKEN > 管道 stdin > 交互隐藏输入。
 * 令牌永不写入命令行参数(04 §8)。
 */
export async function readEnrollToken(input: TokenInput): Promise<string> {
  if (input.env !== undefined && input.env.trim() !== "") {
    return input.env.trim();
  }
  const stdin = input.stdin ?? process.stdin;
  if (!("isTTY" in stdin && stdin.isTTY === true)) {
    const piped = await readAllStdin(stdin);
    if (piped !== "") {
      return piped;
    }
  }
  return (input.prompt ?? promptHidden)("enroll token(一次性,输入不回显): ");
}

function parseBody(text: string): unknown {
  if (text === "") {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface EnrollOptions {
  consoleUrl: string;
  token: string;
  hostname?: string;
  os?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * 一次性 enroll token 兑换机器身份与长期采集密钥(04 §8):
 * 响应明文只在本函数返回值出现一次,由调用方立即落 0600 凭据文件。
 */
export async function enrollMachine(options: EnrollOptions): Promise<EnrollResponseBody> {
  const body: EnrollRequestBody = {
    token: options.token,
    hostname: options.hostname ?? hostname(),
    os: options.os ?? process.platform,
    collector_version: COLLECTOR_VERSION,
  };
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${options.consoleUrl}/api/aw-node/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
  } catch (error) {
    throw new Error(`enroll 请求失败: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  const text = await response.text();
  const parsed = parseBody(text);
  if (!response.ok) {
    const message =
      typeof parsed === "object" && parsed !== null
        ? ((parsed as Record<string, unknown>).error as Record<string, unknown> | undefined)?.message
        : undefined;
    throw new Error(`enroll 被拒绝(HTTP ${response.status}): ${typeof message === "string" ? message : text.slice(0, 200)}`);
  }
  const result = parsed as Partial<EnrollResponseBody> | null;
  if (
    typeof result?.machine_id !== "string" ||
    typeof result?.collector_secret !== "string"
  ) {
    throw new Error("enroll 响应缺少 machine_id / collector_secret");
  }
  return result as EnrollResponseBody;
}
