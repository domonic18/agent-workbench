/** 一次性密钥只展示一次,这里给出落地位置提示(不含真实地址) */
export function agentEnvHints(agentId: string): string[] {
  return ["AW_AGENT_ID = " + agentId, "AW_AGENT_SECRET = 上方密钥", "CONSOLE_URL = 控制台地址"];
}

export function machineEnvHints(machineId: string): string[] {
  return [
    "AW_COLLECTOR_ID = " + machineId,
    "AW_COLLECTOR_SECRET = 上方密钥",
    "AW_INGEST_URL = 控制台地址",
  ];
}
