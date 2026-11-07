import { MCP_ACCESS, formatBearer } from "@shared/constants.js";

/** 一次性密钥只展示一次,这里给出落地位置提示(不含真实地址与密钥) */
export function agentEnvHints(agentId: string): string[] {
  return [
    `MCP 端点 = 控制台地址 + ${MCP_ACCESS.path}`,
    `鉴权头 = ${MCP_ACCESS.authHeader}: ${formatBearer(agentId, "<上面密钥>")}`,
  ];
}

export function machineEnvHints(machineId: string): string[] {
  return [
    "AW_COLLECTOR_ID = " + machineId,
    "AW_COLLECTOR_SECRET = 上方密钥",
    "AW_INGEST_URL = 控制台地址",
  ];
}
