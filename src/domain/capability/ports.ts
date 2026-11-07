/** Teleport 侧 bot traits 入参(05 §4) */
export interface TaskTraits {
  botName: string;
  taskId: string;
  ticketId: string;
}

/** 能力签发端口:由适配器实现,领域只依赖此契约 */
export interface CapabilityTeleportPort {
  /** 把任务与票据写进 bot traits;tbot 在下一个 renewal 周期内生效 */
  applyTaskTraits(traits: TaskTraits): Promise<void>;
}

/** Teleport 审计中的一次会话建立(05 §7:归因只读 user_traits,不读证书扩展) */
export interface SessionStartEvent {
  sid: string;
  user: string;
  login: string;
  serverHostname: string;
  /** user_traits.aw_task_id[0];缺失为 null */
  taskId: string | null;
  /** user_traits.aw_ticket_id[0];缺失为 null */
  ticketId: string | null;
  /** epoch ms(由事件 time 解析) */
  time: number;
}

/** 审计对账端口:由适配器实现 */
export interface TeleportAuditPort {
  /** 读审计日志,返回全部 session.start;文件不可读即抛错,不返回空列表 */
  listSessionStarts(): Promise<SessionStartEvent[]>;
}
