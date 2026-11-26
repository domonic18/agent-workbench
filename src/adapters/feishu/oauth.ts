import type { FeishuConfig } from "../../config/env.js";

const FEISHU_TOKEN_URL = "https://open.feishu.cn/open-apis/authen/v2/oauth/token";
const FEISHU_USER_INFO_URL = "https://open.feishu.cn/open-apis/authen/v1/user_info";
const OUTBOUND_TIMEOUT_MS = 10_000;

export interface FeishuOauthUser {
  openId: string;
  unionId: string;
  name: string;
}

/** 免登出站错误:status 供路由层 domainError 映射;message 不携带 appSecret 与请求体 */
export class FeishuOauthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "FeishuOauthError";
    this.code = code;
    this.status = status;
  }
}

interface TokenResponse {
  access_token?: unknown;
  error?: unknown;
  error_description?: unknown;
}

interface UserInfoResponse {
  code?: unknown;
  msg?: unknown;
  data?: { open_id?: unknown; union_id?: unknown; name?: unknown };
}

function unreachable(): FeishuOauthError {
  return new FeishuOauthError("FEISHU_UNREACHABLE", "飞书服务不可达,请稍后重试", 502);
}

/**
 * JSAPI 免登 code(一次性,3 分钟有效)换用户身份。
 * 非重定向流,不携带 redirect_uri;appSecret 只进出站请求体,不进任何错误消息。
 */
export async function exchangeFeishuCode(
  code: string,
  credentials: Pick<FeishuConfig, "appId" | "appSecret">,
): Promise<FeishuOauthUser> {
  const tokenRes = await fetch(FEISHU_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: credentials.appId,
      client_secret: credentials.appSecret,
      code,
    }),
    signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
  }).catch(() => {
    throw unreachable();
  });
  const tokenBody = (await tokenRes.json().catch(() => null)) as TokenResponse | null;
  if (!tokenRes.ok || typeof tokenBody?.access_token !== "string") {
    throw new FeishuOauthError("FEISHU_CODE_INVALID", "飞书授权码无效或已过期", 401);
  }

  const infoRes = await fetch(FEISHU_USER_INFO_URL, {
    headers: { authorization: `Bearer ${tokenBody.access_token}` },
    signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
  }).catch(() => {
    throw unreachable();
  });
  const infoBody = (await infoRes.json().catch(() => null)) as UserInfoResponse | null;
  const openId = infoBody?.data?.open_id;
  if (!infoRes.ok || infoBody?.code !== 0 || typeof openId !== "string" || openId === "") {
    throw new FeishuOauthError("FEISHU_USERINFO_FAILED", "获取飞书用户信息失败", 401);
  }
  return {
    openId,
    unionId: typeof infoBody.data?.union_id === "string" ? infoBody.data.union_id : "",
    name: typeof infoBody.data?.name === "string" ? infoBody.data.name : "",
  };
}
