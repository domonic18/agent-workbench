import type { PreHandler } from "./session.js";

/**
 * 基础安全响应头(01 §3)。
 * HSTS 不在这里下发:控制台自身走 http,浏览器只认 https 响应里的 HSTS,
 * 必须由 TLS 终结点(nginx / frps 的 https vhost)加——见 deployment 文档。
 */
export function securityHeaders(): PreHandler {
  return async (_request, reply) => {
    // 接口一律返回 JSON,禁止浏览器按 MIME 猜测内容类型
    reply.header("x-content-type-options", "nosniff");
    // 控制台带会话 cookie,禁止被任意站点套 iframe 做点击劫持
    reply.header("x-frame-options", "DENY");
    // URL 里带 id / token 形态的路径参数,不外泄给第三方
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
  };
}
