import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { healthPayload } from "../shared/health.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const startedAt = Date.now();
// dist/server 与 src/server 到仓库根同为两级,容器内亦然
const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(healthPayload(version, startedAt)));
    return;
  }

  response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  response.end(
    JSON.stringify({ error: { code: "NOT_FOUND", message: "not found" } }),
  );
});

function shutdown(): void {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.listen(port, host, () => {
  console.log(`agent-workbench listening on http://${host}:${port}`);
});
