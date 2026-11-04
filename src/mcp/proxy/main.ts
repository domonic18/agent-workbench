import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { postToolCallAudit } from "./audit-client.js";
import { loadProxyConfig } from "./config.js";
import { callConsole } from "./console-client.js";
import { createFeishuNotifier } from "./feishu.js";
import { createGateway } from "./gateway.js";
import { createStderrLogger } from "./logger.js";
import { createNativeTools } from "./native.js";
import { createProxyServer } from "./server.js";
import { connectUpstream } from "./upstream.js";

export async function main(): Promise<void> {
  const config = loadProxyConfig();
  const log = createStderrLogger();
  const upstreams = await Promise.all(config.upstreams.map((entry) => connectUpstream(entry)));
  const consoleClient = {
    baseUrl: config.consoleBaseUrl,
    agentId: config.ctx.agentId,
    agentSecret: config.agentSecret,
  };
  // 飞书凭据只用于自报 bot 身份(identity registration);协作群播报由控制台直发(2026-11-02 裁决)
  const feishu =
    config.feishu === undefined
      ? undefined
      : createFeishuNotifier(config.feishu.appId, config.feishu.appSecret);
  const nativeTools = createNativeTools({ ...consoleClient });

  const gateway = createGateway({
    ctx: config.ctx,
    upstreams,
    nativeTools,
    audit: (entry) => postToolCallAudit(consoleClient, entry),
    toolMap: config.toolMap,
    log,
  });
  const server = createProxyServer(gateway);
  await server.connect(new StdioServerTransport());
  log.info(
    { agentId: config.ctx.agentId, taskId: config.ctx.taskId, upstreams: upstreams.map((u) => u.id) },
    "MCP proxy 已就绪",
  );
  if (config.feishuWarning !== undefined) {
    log.warn({ reason: config.feishuWarning }, "飞书凭据未自动发现");
  } else if (config.feishuSource !== undefined) {
    log.info({ source: config.feishuSource }, "飞书凭据已加载");
  }

  // 自报 bot 身份失败只影响 <at> 渲染,不阻断工具通道
  const feishuAppId = config.feishu?.appId;
  if (feishu !== undefined) {
    void feishu
      .identify()
      .then((identity) =>
        callConsole(consoleClient, {
          method: "PUT",
          path: "/api/agents/self/feishu-bot",
          body: {
            open_id: identity.openId,
            name: identity.name,
            ...(feishuAppId === undefined ? {} : { app_id: feishuAppId }),
          },
        }),
      )
      .then((response) => {
        if (response.status < 200 || response.status >= 300) {
          log.warn({ status: response.status }, "飞书 bot 身份注册失败");
        }
      })
      .catch((error: unknown) => {
        log.error({ err: error }, "飞书 bot 身份注册失败");
      });
  }

  const shutdown = async (): Promise<void> => {
    await Promise.allSettled(upstreams.map((upstream) => upstream.close()));
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
