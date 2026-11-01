import type { PreHandler } from "./session.js";

/**
 * 来源白名单(01 §3):只校验 Host,必须是白名单值(含端口)。
 * `X-Forwarded-For` 不作准入依据——frpc 在容器内转发,来源恒为网桥地址且头可伪造;
 * 这里只把它写进日志,用于排查谁打过这个端口。
 */
export function requireAllowedHost(allowedHosts: readonly string[]): PreHandler {
  const allowed = new Set(allowedHosts.map((host) => host.trim().toLowerCase()));

  return async (request, reply) => {
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
