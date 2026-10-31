import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDatabase } from "../../store/database.js";
import { insertToolCallLog } from "../../store/repositories/tool-call-log.js";
import { loadProxyConfig } from "./config.js";
import { createGateway } from "./gateway.js";
import { createStderrLogger } from "./logger.js";
import { createNativeTools } from "./native.js";
import { createProxyServer } from "./server.js";
import { connectUpstream } from "./upstream.js";

export async function main(): Promise<void> {
  const config = loadProxyConfig();
  const log = createStderrLogger();
  const db = openDatabase(config.databasePath);
  const upstreams = await Promise.all(config.upstreams.map((entry) => connectUpstream(entry)));
  const nativeTools = createNativeTools({
    baseUrl: config.consoleBaseUrl,
    agentId: config.ctx.agentId,
    agentSecret: config.agentSecret,
  });

  const gateway = createGateway({
    ctx: config.ctx,
    upstreams,
    nativeTools,
    audit: (entry) => insertToolCallLog(db, entry),
    ...(config.approvalTimeoutMs === undefined
      ? {}
      : { approvalTimeoutMs: config.approvalTimeoutMs }),
    toolMap: config.toolMap,
    log,
  });
  const server = createProxyServer(gateway);
  await server.connect(new StdioServerTransport());
  log.info(
    { agentId: config.ctx.agentId, taskId: config.ctx.taskId, upstreams: upstreams.map((u) => u.id) },
    "MCP proxy 已就绪",
  );

  const shutdown = async (): Promise<void> => {
    await Promise.allSettled(upstreams.map((upstream) => upstream.close()));
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        level: "error",
        msg: "MCP proxy 启动失败",
        err: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    process.exit(1);
  });
}
