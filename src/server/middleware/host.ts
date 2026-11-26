import type { Db } from "../../store/database.js";
import { readSystemConfig } from "../../store/repositories/system-config.js";
import type { PreHandler } from "./session.js";

/**
 * 来源白名单支持运行时热读:DB 系统配置覆盖 env 值;DB 读失败时回落到 env fallback,
 * 避免配置表故障把管理员锁在外面。
 */
export function requireAllowedHost(
  envFallback: readonly string[],
  getHosts: () => Promise<readonly string[]>,
): PreHandler {
  return async (request, reply) => {
    let hosts = envFallback;
    try {
      hosts = await getHosts();
    } catch (error) {
      request.log.warn({ err: error }, "读取 Host 白名单失败,使用 env 回落值");
    }
    const allowed = new Set(hosts.map((host) => host.trim().toLowerCase()));

    const forwardedFor = request.headers["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor !== "") {
      request.log.info(
        {
          host: request.headers.host,
          forwardedFor,
          remoteAddress: request.ip,
          method: request.method,
          url: request.url,
        },
        "经代理的外部来源请求",
      );
    }

    const host = request.headers.host;
    if (host === undefined || !allowed.has(host.toLowerCase())) {
      return reply
        .code(403)
        .send({ error: { code: "FORBIDDEN", message: "Host 不在白名单内" } });
    }
    return undefined;
  };
}

export async function resolveAllowedHosts(
  db: Db,
  envFallback: readonly string[],
): Promise<readonly string[]> {
  const rows = await readSystemConfig(db);
  const raw = rows["console_allowed_hosts"];
  if (raw === undefined) {
    return envFallback;
  }
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "");
}
