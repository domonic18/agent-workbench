/**
 * 飞书身份自报:原生 fetch 实现(租户 token + /bot/v3/info)。
 * 2026-11-02 从 Lark SDK 改为 fetch——proxy 部署形态是零依赖单文件 bundle,
 * SDK 的 CJS 动态 require 与 __dirname 在 ESM bundle 里不可用,且此处只用一个只读接口。
 */

const LARK_BASE = "https://open.feishu.cn/open-apis";
const TOKEN_TTL_MS = 100 * 60 * 1000; // 官方租户 token 有效期 2h,取 100 分钟留余量

export interface FeishuBotIdentity {
  openId: string;
  name: string;
}

export interface FeishuNotifier {
  /** /bot/v3/info 自报 open_id 与展示名,控制台据此维护身份映射(播报式裁决后不再发群) */
  identify(): Promise<FeishuBotIdentity>;
}

interface TenantTokenResponse {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
}

interface BotInfoResponse {
  code?: number;
  msg?: string;
  bot?: { open_id?: string; app_name?: string };
}

function ensureOk(
  response: { code?: number | undefined; msg?: string | undefined },
  action: string,
): void {
  const code = response.code ?? 0;
  if (code !== 0) {
    throw new Error(`飞书${action}失败: code=${code} msg=${response.msg ?? ""}`);
  }
}

export function createFeishuNotifier(appId: string, appSecret: string): Promise<FeishuNotifier>{
  let cachedToken: { token: string; expiresAt: number } | undefined;
  return {
    identify: async () => {
      if (cachedToken === undefined || cachedToken.expiresAt <= Date.now()) {
        const tokenResponse = (await (
          await fetch(`${LARK_BASE.replace("/open-apis", "")}/auth/v3/tenant_access_token/internal`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
          })
        ).json()) as TenantTokenResponse;
        ensureOk(tokenResponse, "获取租户 token");
        const token = tokenResponse.tenant_access_token;
        if (token === undefined || token === "") {
          throw new Error("飞书租户 token 响应缺 tenant_access_token");
        }
        cachedToken = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
      }
      const response = (await (
        await fetch(`${LARK_BASE}/bot/v3/info`, {
          headers: { authorization: `Bearer ${cachedToken.token}` },
        })
      ).json()) as BotInfoResponse;
      ensureOk(response, "查询 bot 身份");
      const openId = response.bot?.open_id;
      const name = response.bot?.app_name;
      if (openId === undefined || openId === "" || name === undefined || name === "") {
        throw new Error("飞书 bot 信息缺 open_id 或 app_name");
      }
      return { openId, name };
    },
  };
}
