import type { WorkItemRecord } from "../../store/repositories/work-item.js";
import type { WorkTriggerRecord } from "../../store/repositories/work-trigger.js";
import type { RouteReason, ThreadRef } from "../routing/router.js";

/**
 * 归一化 WorkRequest 契约(arch/01 §9.1):由可信 Source 适配器产出。
 * M3.9-1 唯一入口是控制台会话触发 API;真实 Bug/Git/CI 适配器按同一契约随 M3.9-2 接入。
 * sourceEventId 是幂等键:同一外部事件重推返回首次处置,不重复开工。
 */
export interface WorkRequest {
  readonly source: string;
  readonly sourceEventId: string;
  readonly kind: string;
  readonly occurredAt: number;
  readonly actor: Record<string, unknown>;
  readonly project?: string | undefined;
  readonly threadRefs: readonly ThreadRef[];
  readonly payload: Record<string, unknown>;
  readonly refs: readonly unknown[];
  readonly authorizationRef?: string | undefined;
}

export interface IngestResult {
  readonly replayed: boolean;
  readonly trigger: WorkTriggerRecord;
  readonly workItem: WorkItemRecord | undefined;
  /** 本次 ingest 新建的 worker_inbox 行 id;重放时空 */
  readonly inboxIds: readonly string[];
}

export class WorkIngestError extends Error {
  constructor(
    readonly code: "VALIDATION_FAILED",
    message: string,
  ) {
    super(message);
  }
}

export interface ResolvedDisposition {
  disposition: "routed" | "continued" | "needs_person";
  reasonCode: RouteReason | null;
  ruleId: string | null;
  ruleVersion: string | null;
  workItemId: string | null;
  targetAgentId: string | null;
}

/** 派工分支共享的执行上下文:ingest 事务内由编排层一次构建 */
export interface DispatchContext {
  readonly request: WorkRequest;
  readonly triggerId: string;
  readonly at: number;
  readonly project: string;
  readonly authorizationRef: string | null;
  readonly refsJson: string;
  readonly threadRefsJson: string;
  readonly boundThreads: readonly { threadId: string; threadKey: string }[];
}
