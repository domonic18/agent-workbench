import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import {
  createRevisionService,
  type RevisionService,
} from "../../domain/revision/service.js";
import { SSE } from "../../shared/constants.js";
import { isScopeName, OVERVIEW_SCOPE } from "../../shared/scopes.js";
import type { Db } from "../../store/database.js";
import { requireSession } from "../middleware/session.js";
import {
  createStreamRegistry,
  type StreamRegistry,
} from "../stream/registry.js";
import { invalid } from "./http.js";

export interface StreamRoutesOptions {
  db: Db;
  now?: () => number;
  heartbeatMs?: number;
  pollMs?: number;
  maxClients?: number;
  registry?: StreamRegistry;
  revisions?: RevisionService;
}

function parseClientId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(trimmed) ? trimmed : undefined;
}

/** 缺省订阅 overview;重复 scope 参数去重,任一非法即整体拒绝 */
function parseScopes(value: unknown): string[] | undefined {
  if (value === undefined) {
    return [OVERVIEW_SCOPE];
  }
  const raw = Array.isArray(value) ? value : [value];
  const scopes: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !isScopeName(item)) {
      return undefined;
    }
    if (!scopes.includes(item)) {
      scopes.push(item);
    }
  }
  return scopes;
}

function writeEvent(stream: ServerResponse, event: string, data: unknown): void {
  stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * 首帧 snapshot 携带当前水位,之后只推 delta。delta 不带投影数据,
 * 客户端据此失效查询后自行重拉 REST;revision 跳号时同样按缺口处理。
 */
export function registerStreamRoutes(app: FastifyInstance, options: StreamRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const heartbeatMs = options.heartbeatMs ?? SSE.heartbeatMs;
  const pollMs = options.pollMs ?? SSE.pollMs;
  const registry = options.registry ?? createStreamRegistry(options.maxClients ?? SSE.maxClients);
  const revisions = options.revisions ?? createRevisionService({ db });
  const session = requireSession(db, now);

  app.get("/api/stream", { preHandler: session }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;

    const clientId = parseClientId(query.client_id);
    if (clientId === undefined) {
      return invalid(reply, "client_id 必须是 1~128 位字母、数字、下划线或短横线");
    }
    const scopes = parseScopes(query.scope);
    if (scopes === undefined) {
      return invalid(reply, "scope 只接受 overview 或 task:<id>");
    }
    if (!registry.acquire(clientId)) {
      return reply.code(429).send({
        error: { code: "RATE_LIMITED", message: "实时连接数超过上限" },
      });
    }

    reply.hijack();
    const stream = reply.raw;
    stream.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // 首帧与基准取自同一次读取,否则两次读之间的变更会多推一条 delta
    const initial = await revisions.snapshot(scopes);
    const seen = new Map(initial.map((entry) => [entry.scope, entry.revision]));
    writeEvent(stream, "snapshot", { scopes: initial, at: now() });

    const poll = setInterval(() => {
      void revisions
        .snapshot(scopes)
        .then((entries) => {
          for (const { scope, revision } of entries) {
            if (revision > (seen.get(scope) ?? 0)) {
              seen.set(scope, revision);
              writeEvent(stream, "delta", { scope, revision });
            }
          }
        })
        .catch(() => undefined);
    }, pollMs);
    const heartbeat = setInterval(() => {
      writeEvent(stream, "heartbeat", { at: now() });
    }, heartbeatMs);

    let closed = false;
    const cleanup = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
      registry.release(clientId);
    };
    stream.on("close", cleanup);
    stream.on("error", cleanup);
  });
}
