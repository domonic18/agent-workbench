import { randomUUID } from "node:crypto";
import type {
  ConfigAckRequest,
  ConfigAckResponse,
  DiscoveryReport,
  PullConfigResponse,
} from "../../src/shared/aw-node-wire.js";

export interface OutgoingEvent {
  seq: number;
  inode: number;
  offset: number;
  kind: string;
  occurred_at: number;
  payload: unknown;
}

export interface BatchRequest {
  collector_id: string;
  agent_project: string;
  stream_id: string;
  batch: OutgoingEvent[];
  sent_at: number;
}

export interface BatchResponse {
  acked_seq: number;
  /** 被服务端跳过(内容存不下)的坏项数;大于 0 表示有事件没入库 */
  rejected?: number;
}

export class ConsoleHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`控制台返回 HTTP ${status}${describeError(body)}`);
    this.name = "ConsoleHttpError";
    this.status = status;
    this.body = body;
  }
}

function describeError(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return "";
  }
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) {
    return "";
  }
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" ? `: ${message}` : "";
}

export interface ConsoleClientOptions {
  ingestUrl: string;
  baseUrl: string;
  collectorId: string;
  secret: string;
  timeoutMs?: number;
}

export interface ConsoleClient {
  postBatch(request: BatchRequest): Promise<BatchResponse>;
  postHeartbeat(payload: Record<string, unknown>): Promise<{ ok: boolean; projects: string[] }>;
  getProjects(): Promise<string[]>;
  healthz(): Promise<boolean>;
  postDiscovery(report: DiscoveryReport): Promise<{ ok: boolean; received_at: number }>;
  pullConfig(): Promise<PullConfigResponse>;
  ackConfig(acks: ConfigAckRequest["agents"]): Promise<ConfigAckResponse>;
}

function asProjects(value: unknown): string[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const projects = (value as Record<string, unknown>).projects;
  if (!Array.isArray(projects)) {
    return [];
  }
  return projects.filter((item): item is string => typeof item === "string");
}

export function createConsoleClient(options: ConsoleClientOptions): ConsoleClient {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const auth = `Bearer ${options.collectorId}.${options.secret}`;

  async function request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(path, {
        ...init,
        headers: {
          authorization: auth,
          "content-type": "application/json",
          ...init.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`请求控制台失败: ${message}`, { cause: error });
    }
    const text = await response.text();
    let body: unknown = null;
    if (text !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      throw new ConsoleHttpError(response.status, body);
    }
    return body;
  }

  return {
    async postBatch(requestBody) {
      const body = await request(options.ingestUrl, {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
      const acked = typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).acked_seq
        : undefined;
      if (typeof acked !== "number" || !Number.isInteger(acked) || acked < 0) {
        throw new Error("控制台响应缺少有效的 acked_seq");
      }
      const rejected = typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).rejected
        : undefined;
      return {
        acked_seq: acked,
        rejected: typeof rejected === "number" ? rejected : 0,
      };
    },

    async postHeartbeat(payload) {
      const body = await request(`${options.baseUrl}/api/ingest/heartbeat`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return { ok: true, projects: asProjects(body) };
    },

    async getProjects() {
      const body = await request(`${options.baseUrl}/api/ingest/projects`, { method: "GET" });
      return asProjects(body);
    },

    async healthz() {
      try {
        const response = await fetch(`${options.baseUrl}/healthz`, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        return response.ok;
      } catch {
        return false;
      }
    },

    async postDiscovery(report) {
      const body = await request(`${options.baseUrl}/api/aw-node/discovery`, {
        method: "POST",
        headers: { "idempotency-key": randomUUID() },
        body: JSON.stringify(report),
      });
      const ok = (body as Record<string, unknown> | null)?.ok === true;
      if (!ok) {
        throw new Error("发现上报响应异常");
      }
      return body as { ok: boolean; received_at: number };
    },

    async pullConfig() {
      return (await request(`${options.baseUrl}/api/aw-node/config`, {
        method: "POST",
        body: "{}",
      })) as PullConfigResponse;
    },

    async ackConfig(acks: ConfigAckRequest["agents"]) {
      return (await request(`${options.baseUrl}/api/aw-node/config/ack`, {
        method: "POST",
        headers: { "idempotency-key": randomUUID() },
        body: JSON.stringify({ agents: acks } satisfies ConfigAckRequest),
      })) as ConfigAckResponse;
    },
  };
}
