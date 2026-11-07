/** 一次性的明文凭据:只存在组件 state,离开页面即消失 */
export interface AgentCredentials {
  agentId: string;
  displayName: string;
  secret: string;
}
