/** 通知只承载渲染所需字段;协作群播报由控制台以自身应用直发,不需要 bot open_id */
export interface CollabAgentRef {
  id: string;
  displayName: string;
}

export interface HandoffNotice {
  msgId: string;
  taskId: string;
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
  /** 结论摘要:下游回传的实际结论;取不到时为 null,播报退回「已同步给 X」 */
  conclusion: string | null;
}

export interface ClosureNotice {
  taskId: string;
  title: string;
  /** 结论摘要:根任务收口时取自下游回执;取不到时为 null,播报不写「结论」行 */
  conclusion: string | null;
}
