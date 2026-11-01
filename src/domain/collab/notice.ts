/** 通知只承载渲染所需字段;botOpenId 由 proxy 自报注册,未注册时为 null */
export interface CollabAgentRef {
  id: string;
  displayName: string;
  botOpenId: string | null;
}

export interface HandoffNotice {
  msgId: string;
  taskId: string;
  threadId: string;
  summary: string;
  from: CollabAgentRef;
  to: CollabAgentRef;
}

export interface CompletionNotice {
  taskId: string;
  title: string;
  from: CollabAgentRef;
  to: CollabAgentRef;
}
