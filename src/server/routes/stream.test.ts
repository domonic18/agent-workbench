import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { insertAgent, insertMachine } from "../../store/repositories/identity.js";
import { ensureConsoleCredential } from "../credential.js";
import { createStreamRegistry, type StreamRegistry } from "../stream/registry.js";
import { registerAuthRoutes } from "./auth.js";
import { registerStreamRoutes } from "./stream.js";

const PASSWORD = "secret123";
const AT = 1_700_000_000_000;

interface SseFrame {
  event: string;
  data: unknown;
}

function cookieOf(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    throw new Error("响应没有 set-cookie");
  }
  return value.split(";")[0] as string;
}

function openSse(response: Response): {
  next(timeoutMs?: number): Promise<SseFrame>;
  close(): Promise<void>;
} {
  const body = response.body;
  if (body === null) {
    throw new Error("响应没有 body");
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const queue: SseFrame[] = [];
  let buffer = "";
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const lines = raw.split("\n");
        const event = lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "message";
        const data = lines
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        queue.push({ event, data: JSON.parse(data) as unknown });
        index = buffer.indexOf("\n\n");
      }
    }
  })();
  return {
    async next(timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      while (queue.length === 0) {
        if (Date.now() > deadline) {
          throw new Error("等待 SSE 帧超时");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return queue.shift() as SseFrame;
    },
    async close() {
      await reader.cancel().catch(() => undefined);
    },
  };
}

describe("stream 路由", () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;
  let baseUrl: string;
  let registry: StreamRegistry;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    runMigrations(db);
    ensureConsoleCredential(db, PASSWORD);
    app = Fastify({ logger: false });
    registry = createStreamRegistry(2);
    registerAuthRoutes(app, { db, now: () => AT });
    registerStreamRoutes(app, {
      db,
      now: () => AT,
      pollMs: 10,
      heartbeatMs: 40,
      registry,
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    cookie = cookieOf(login);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    app.server.closeAllConnections();
    await app.close();
    // 连接关闭事件异步派发,未清完就关库会让轮询定时器撞上已关闭的 db
    const deadline = Date.now() + 2000;
    while (registry.clientCount() !== 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    db.close();
  });

  function connect(query: string): Promise<Response> {
    return fetch(`${baseUrl}/api/stream?${query}`, {
      headers: { cookie },
    });
  }

  it("未登录返回 401", async () => {
    const response = await app.inject({ method: "GET", url: "/api/stream?client_id=c1" });
    expect(response.statusCode).toBe(401);
  });

  it("缺少 client_id 或 scope 非法返回 422", async () => {
    const missing = await app.inject({
      method: "GET",
      url: "/api/stream",
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(422);
    const badClientId = await app.inject({
      method: "GET",
      url: "/api/stream?client_id=bad%20id",
      headers: { cookie },
    });
    expect(badClientId.statusCode).toBe(422);
    const badScope = await app.inject({
      method: "GET",
      url: "/api/stream?client_id=c1&scope=task:",
      headers: { cookie },
    });
    expect(badScope.statusCode).toBe(422);
  });

  it("首帧为 snapshot,水位变化推 delta", async () => {
    const response = await connect("client_id=c1&scope=overview");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const sse = openSse(response);
    expect(await sse.next()).toEqual({
      event: "snapshot",
      data: { scopes: [{ scope: "overview", revision: 0 }], at: AT },
    });

    insertMachine(db, {
      id: "m1",
      hostname: "host",
      os: "darwin",
      collectorVersion: "1.0.0",
      collectorSecretHash: "h",
      createdAt: AT,
    });
    insertAgent(db, {
      id: "a1",
      machineId: "m1",
      project: "proj",
      displayName: "Agent",
      secretHash: "h",
      feishuAppId: null,
      allowedTargetsJson: "[]",
      createdAt: AT,
    });

    expect(await sse.next()).toEqual({
      event: "delta",
      data: { scope: "overview", revision: 1 },
    });
    await sse.close();
  });

  it("订阅多个作用域并按各自水位推送", async () => {
    const response = await connect("client_id=c1&scope=overview&scope=task:tsk_1");
    const sse = openSse(response);
    expect(await sse.next()).toEqual({
      event: "snapshot",
      data: {
        scopes: [
          { scope: "overview", revision: 0 },
          { scope: "task:tsk_1", revision: 0 },
        ],
        at: AT,
      },
    });
    await sse.close();
  });

  it("定期推送 heartbeat", async () => {
    const response = await connect("client_id=c1");
    const sse = openSse(response);
    expect((await sse.next()).event).toBe("snapshot");
    expect(await sse.next()).toEqual({ event: "heartbeat", data: { at: AT } });
    await sse.close();
  });

  it("client_id 超过上限返回 429", async () => {
    const first = openSse(await connect("client_id=c1"));
    const second = openSse(await connect("client_id=c2"));
    await first.next();
    await second.next();

    const third = await app.inject({
      method: "GET",
      url: "/api/stream?client_id=c3",
      headers: { cookie },
    });
    expect(third.statusCode).toBe(429);
    expect(third.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });

    await first.close();
    await second.close();
    const deadline = Date.now() + 2000;
    while (registry.clientCount() !== 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(registry.clientCount()).toBe(0);
  });
});
