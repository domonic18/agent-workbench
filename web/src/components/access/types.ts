/** 一次性的明文凭据:只存在组件 state,离开页面即消失 */
export interface AgentCredentials {
  agentId: string;
  displayName: string;
  secret: string;
}

/** 一次性接入令牌:人签发、Agent 兑换;只存在组件 state */
export interface AgentEnrollGrant {
  agentId: string;
  displayName: string;
  token: string;
  expiresAt: number;
}
