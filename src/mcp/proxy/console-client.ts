export interface ConsoleClientConfig {
  baseUrl: string;
  agentId: string;
  agentSecret: string;
  /** 单次请求超时(ms);a2a_inbox 需 >= 30s 容纳长轮询,由调用方显式放宽 */
  timeoutMs?: number;
}

export interface ConsoleRequest {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
  query?: Record<string, string>;
  /** 写操作必带;读操作不带 */
  idempotencyKey?: string;
  timeoutMs?: number;
}

export interface ConsoleResponse {
  status: number;
  /** 2xx 为响应体;非 2xx 为 `{ error: { code, message, detail? } }` */
  body: unknown;
}

const DEFAULT_TIMEOUT_MS = 10_000;

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * 原生工具到控制面的唯一通道:业务写只走控制台路由,Bearer 身份由 proxy 持有。
 * 不自动重试——幂等键每次工具调用新生成,重试只会造重复消息。
 */
export async function callConsole(
  config: ConsoleClientConfig,
  request: ConsoleRequest,
): Promise<ConsoleResponse> {
  const url = new URL(request.path, config.baseUrl);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${config.agentId}.${config.agentSecret}`,
  };
  if (request.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (request.idempotencyKey !== undefined) {
    headers["idempotency-key"] = request.idempotencyKey;
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    request.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      method: request.method,
      headers,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      signal: controller.signal,
    });
    return { status: response.status, body: await readBody(response) };
  } finally {
    clearTimeout(timer);
  }
}
