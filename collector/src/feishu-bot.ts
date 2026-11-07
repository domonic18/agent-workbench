export interface FeishuBotIdentity {
  name: string;
  openId: string;
}

export type FetchLike = typeof fetch;

const TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const BOT_INFO_URL = "https://open.feishu.cn/open-apis/bot/v3/info";

/** 用应用凭据换租户 token;失败返回 undefined,由调用方下轮重试 */
async function fetchTenantToken(
  appId: string,
  appSecret: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<string | undefined> {
  try {
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await response.json()) as { tenant_access_token?: unknown };
    const token = json.tenant_access_token;
    return typeof token === "string" && token !== "" ? token : undefined;
  } catch {
    return undefined;
  }
}

/** 凭租户 token 取 bot 名与 open_id;失败返回 undefined */
async function fetchBotInfo(
  token: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<FeishuBotIdentity | undefined> {
  try {
    const response = await fetchImpl(BOT_INFO_URL, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await response.json()) as {
      code?: unknown;
      bot?: { app_name?: unknown; open_id?: unknown };
    };
    const bot = json.bot;
    if (json.code !== 0 || bot === undefined || typeof bot.open_id !== "string") {
      return undefined;
    }
    const name = typeof bot.app_name === "string" && bot.app_name !== "" ? bot.app_name : undefined;
    return { name: name ?? "bot", openId: bot.open_id };
  } catch {
    return undefined;
  }
}

/**
 * 用应用自身凭据换取租户 token 后调 bot/v3/info 取机器人名与 open_id。
 * 凭据只在本机内存流转,永不写入发现上报;失败返回 undefined,由调用方下轮重试。
 */
export async function fetchFeishuBotIdentity(
  appId: string,
  appSecret: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 10_000,
): Promise<FeishuBotIdentity | undefined> {
  const token = await fetchTenantToken(appId, appSecret, fetchImpl, timeoutMs);
  if (token === undefined) {
    return undefined;
  }
  return fetchBotInfo(token, fetchImpl, timeoutMs);
}

export interface CachedFeishuBotResolverOptions {
  /** 租户 token 缓存时长,默认 90 分钟(飞书 token 约 2 小时有效) */
  tokenTtlMs?: number;
  /** bot 名缓存时长,默认 7 天——bot 名很少改,不必每轮现取 */
  identityTtlMs?: number;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

export interface CachedFeishuBotResolver {
  /** 按项目取 bot 身份:命中缓存直接返回;现取失败沿用上一次成功值(即使已过期) */
  resolve(appId: string, appSecret: string, project: string): Promise<FeishuBotIdentity | undefined>;
  /** 清空 bot 名缓存(不含 token),下一轮 resolve 强制现取 */
  invalidateAll(): void;
}

/** 带缓存的 bot 身份解析器:token 按 appId 缓存,bot 名按项目缓存,均内存态 */
export function createCachedFeishuBotResolver(
  options: CachedFeishuBotResolverOptions = {},
): CachedFeishuBotResolver {
  const tokenTtlMs = options.tokenTtlMs ?? 90 * 60_000;
  const identityTtlMs = options.identityTtlMs ?? 7 * 24 * 60 * 60_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const now = options.now ?? Date.now;
  const tokenCache = new Map<string, { token: string; expiresAt: number }>();
  const identityCache = new Map<string, { identity: FeishuBotIdentity; expiresAt: number }>();

  async function tokenFor(appId: string, appSecret: string): Promise<string | undefined> {
    const cached = tokenCache.get(appId);
    if (cached !== undefined && cached.expiresAt > now()) {
      return cached.token;
    }
    const token = await fetchTenantToken(appId, appSecret, fetchImpl, timeoutMs);
    if (token === undefined) {
      return undefined;
    }
    tokenCache.set(appId, { token, expiresAt: now() + tokenTtlMs });
    return token;
  }

  return {
    async resolve(appId, appSecret, project) {
      const cached = identityCache.get(project);
      if (cached !== undefined && cached.expiresAt > now()) {
        return cached.identity;
      }
      const token = await tokenFor(appId, appSecret);
      if (token === undefined) {
        return cached?.identity;
      }
      const identity = await fetchBotInfo(token, fetchImpl, timeoutMs);
      if (identity === undefined) {
        return cached?.identity;
      }
      identityCache.set(project, { identity, expiresAt: now() + identityTtlMs });
      return identity;
    },
    invalidateAll() {
      identityCache.clear();
    },
  };
}
