export const UNAUTHORIZED_EVENT = "aw:unauthorized";

export interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  // 会话 Cookie 走同源;非只读请求带 CSRF 头(01 §6)
  if (method !== "GET") {
    headers["X-Requested-With"] = "XMLHttpRequest";
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }

  if (!response.ok) {
    let parsed: ApiErrorBody = {};
    try {
      parsed = (await response.json()) as ApiErrorBody;
    } catch {
      // 非 JSON 错误体按通用失败处理
    }
    throw new ApiError(
      response.status,
      parsed.error?.code ?? "UNKNOWN",
      parsed.error?.message ?? `请求失败(${response.status})`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>("GET", path);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>("POST", path, body);
  },
};
