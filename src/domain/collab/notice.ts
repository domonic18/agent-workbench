/** 通知只承载渲染所需字段;协作群播报由控制台以自身应用直发,不需要 bot open_id */
export interface CollabAgentRef {
  id: string;
  displayName: string;
}

export interface HandoffNotice {
  msgId: string;
  taskId: string;
  threadId: string;
  summary: string;
  from: CollabAgentRef;
  to: CollabAgentRef;
}

export interface AcceptNotice {
  msgId: string;
  taskId: string;
  title: string;
  from: CollabAgentRef;
  to: CollabAgentRef;
}

export interface CompletionNotice {
  taskId: string;
  title: string;
  from: CollabAgentRef;
  to: CollabAgentRef;
}

export interface ClosureNotice {
  taskId: string;
  title: string;
}
