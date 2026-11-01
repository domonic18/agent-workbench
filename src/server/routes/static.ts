import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

const NOT_FOUND = { error: { code: "NOT_FOUND", message: "not found" } } as const;

/**
 * 同源托管 web 构建产物(03 §9)。前端路由回退 index.html;
 * /api 与 /healthz 保持 JSON 404,不被 SPA 吞掉。
 */
export function registerWebRoutes(app: FastifyInstance, root: string): void {
  const rootPath = resolve(root);
  const indexPath = resolve(rootPath, "index.html");
  if (!existsSync(indexPath)) {
    app.log.info({ root: rootPath }, "未找到前端产物,跳过静态托管");
    return;
  }

  app.get("/*", (request, reply) => {
    const pathname = request.url.split("?")[0] ?? "/";
    if (pathname === "/healthz" || pathname === "/api" || pathname.startsWith("/api/")) {
      return reply.code(404).send(NOT_FOUND);
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "非法路径" } });
    }

    const target = resolve(rootPath, `.${decoded}`);
    const withinRoot = target === rootPath || target.startsWith(`${rootPath}${sep}`);
    if (!withinRoot || decoded.includes("\0")) {
      return reply.code(404).send(NOT_FOUND);
    }

    if (existsSync(target) && statSync(target).isFile()) {
      const isHashedAsset = decoded.startsWith("/assets/");
      return reply
        .header(
          "content-type",
          MIME_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
        )
        .header(
          "cache-control",
          isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache",
        )
        .send(createReadStream(target));
    }

    // 无扩展名视为前端路由;缺失的带扩展名文件仍按 404,避免掩盖资源错误
    if (extname(decoded) === "") {
      return reply
        .header("content-type", "text/html; charset=utf-8")
        .header("cache-control", "no-cache")
        .send(createReadStream(indexPath));
    }

    return reply.code(404).send(NOT_FOUND);
  });
}
