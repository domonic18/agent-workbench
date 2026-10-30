import { buildApp } from "./app.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "8787", 10);

const app = buildApp({ logLevel: process.env.LOG_LEVEL ?? "info" });

function shutdown(): void {
  void app.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ host, port });
