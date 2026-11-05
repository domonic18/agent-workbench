import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createIngestService } from "../../domain/work/ingest-service.js";
import { WorkIngestError } from "../../domain/work/contract.js";
import { createWorkReadService, type WorkReadService } from "../../domain/work/read.js";
import { createWorkerService } from "../../domain/work/worker-service.js";
import { WorkError } from "../../domain/work/errors.js";
import {
  LIST_LIMITS,
  WORK_ITEM_ATTENTIONS,
  WORK_ITEM_STAGES,
  WORK_ITEM_STATUSES,
  type WorkItemAttention,
  type WorkItemStage,
  type WorkItemStatus,
} from "../../shared/constants.js";
import { parseJsonObject } from "../../shared/json.js";
import type { Db } from "../../store/database.js";
import type { AgentRecord } from "../../store/repositories/identity.js";
import type { WorkItemRecord } from "../../store/repositories/work-item.js";
import type { UsageResolver } from "../../domain/usage/state.js";
import { requireAgentAuth } from "../middleware/agent-auth.js";
import { requireCsrf, requireIdempotencyKey, requireSession } from "../middleware/session.js";
import { invalid } from "./http.js";
import { parseWaitMs } from "./a2a.js";
import { parseKeysetCursor, parseLimit, parseSeq } from "./paging.js";

/**
 * 归一化触发入口(arch/01 §9.1):一期是控制台会话的管理面/联调通道,
 * 不是匿名 webhook——真实 Bug/Git/CI 适配器按同一 WorkRequest 契约随 M3.9-2 接入。
 * 幂等以 (source, source_event_id) 首到先得,重放返回首次处置。
 */
const threadRefSchema = z.object({
  source: z.string().min(1),
  externalKind: z.string().min(1),
  externalKey: z.string().min(1),
});

const triggerSchema = z.object({
  source: z.string().min(1),
  sourceEventId: z.string().min(1),
  kind: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  actor: z.record(z.string(), z.unknown()),
  project: z.string().min(1).optional(),
  threadRefs: z.array(threadRefSchema),
  payload: z.record(z.string(), z.unknown()),
  refs: z.array(z.unknown()),
  authorizationRef: z.string().min(1).optional(),
});

export interface WorkRoutesOptions {
  db: Db;
  now?: () => number;
  read?: WorkReadService;
  /** 协作播报群;工作事项状态卡片发到这里,留空则不入队 */
  collabChatId?: string;
  /** M4-1 实时解析 Agent 用量状态 */
  usageResolver?: UsageResolver;
}

/** 列表条目只带投影列,Mandate 与关联数据走详情 */
function toListItem(item: WorkItemRecord) {
  return {
    id: item.id,
    project: item.project,
    kind: item.kind,
    title: item.title,
    status: item.status,
    stage: item.stage,
    attention: item.attention,
    nextAction: item.nextAction,
    latestSummary: item.latestSummary,
    lastProgressAt: item.lastProgressAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toDetail(item: WorkItemRecord) {
  return {
    ...toListItem(item),
    parentWorkItemId: item.parentWorkItemId,
    expectedResult: item.expectedResult,
    scope: parseJsonObject(item.scopeJson),
    originTriggerId: item.originTriggerId,
    authorization: { kind: item.authorizationKind, ref: item.authorizationRef },
    policyVersion: item.policyVersion,
    progressRevision: item.progressRevision,
    output: item.output,
    validation: parseJsonObject(item.validationJson ?? "{}"),
    acceptanceRef: item.acceptanceRef,
    endedAt: item.endedAt,
  };
}

const ENUM_FILTERS: ReadonlyArray<{ key: string; allowed: readonly string[] }> = [
  { key: "status", allowed: WORK_ITEM_STATUSES },
  { key: "stage", allowed: WORK_ITEM_STAGES },
  { key: "attention", allowed: WORK_ITEM_ATTENTIONS },
];

export function registerWorkRoutes(app: FastifyInstance, options: WorkRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const collab =
    options.collabChatId === undefined ? {} : { collabChatId: options.collabChatId };
  const usageResolver = options.usageResolver;
  const ingest = createIngestService({
    db,
    now,
    ...collab,
    ...(usageResolver === undefined
      ? {}
      : { resolveUsage: (tx, agentId) => usageResolver.resolve(tx, agentId) }),
  }).ingest;
  const read = options.read ?? createWorkReadService({ db });
  const workers = createWorkerService({ db, now, ...collab });
  const writeGuards = [requireSession(db, now), requireCsrf(), requireIdempotencyKey()];
  const agentAuth = requireAgentAuth(db);

  app.post("/api/work/triggers", { preHandler: writeGuards }, async (request, reply) => {
    const parsed = triggerSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({
        error: {
          code: "VALIDATION_FAILED",
          message: "字段缺失或类型错误",
          detail: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
    }
    try {
      const result = await ingest(parsed.data);
      return {
        replayed: result.replayed,
        trigger: result.trigger,
        workItem: result.workItem ?? null,
        inboxIds: result.inboxIds,
      };
    } catch (error) {
      if (error instanceof WorkIngestError) {
        return reply.code(422).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });

  app.get(
    "/api/work/inbox",
    { preHandler: agentAuth },
    async (request, reply) => {
      const agent = request.agent as AgentRecord;
      const query = request.query as Record<string, unknown>;

      let waitMs: number | undefined;
      if (query.wait !== undefined) {
        if (typeof query.wait !== "string") {
          return invalid(reply, "wait 必须形如 25s 或 250ms");
        }
        waitMs = parseWaitMs(query.wait);
        if (waitMs === undefined) {
          return invalid(reply, "wait 必须形如 25s 或 250ms");
        }
      }

      // peek 只看不领(照 a2a peek 先例):aw-node 调度器预检用,不占行租约
      let peek: boolean | undefined;
      if (query.peek !== undefined) {
        if (query.peek !== "1" && query.peek !== "true") {
          return invalid(reply, "peek 只能是 1 或 true");
        }
        peek = true;
      }

      try {
        const views = await workers.inbox(agent.id, {
          ...(waitMs === undefined ? {} : { waitMs }),
          ...(peek === undefined ? {} : { peek }),
        });
        return {
          items: views.map(({ inbox, workItem }) => ({
            inbox_id: inbox.id,
            kind: inbox.kind,
            status: inbox.status,
            trigger_id: inbox.triggerId,
            lease_until: inbox.leaseUntil,
            work_item_id: inbox.workItemId,
            work_item_title: workItem.title,
            created_at: inbox.createdAt,
          })),
        };
      } catch (error) {
        if (error instanceof WorkError) {
          return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }
    },
  );

  app.get("/api/work-items", { preHandler: requireSession(db, now) }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;

    let status: WorkItemStatus | undefined;
    let stage: WorkItemStage | undefined;
    let attention: WorkItemAttention | undefined;
    for (const { key, allowed } of ENUM_FILTERS) {
      const raw = query[key];
      if (raw === undefined) {
        continue;
      }
      if (typeof raw !== "string" || !allowed.includes(raw)) {
        return invalid(reply, `${key} 只接受 ${allowed.join(" / ")}`);
      }
      if (key === "status") {
        status = raw as WorkItemStatus;
      } else if (key === "stage") {
        stage = raw as WorkItemStage;
      } else {
        attention = raw as WorkItemAttention;
      }
    }

    let project: string | undefined;
    if (query.project !== undefined) {
      if (typeof query.project !== "string" || query.project.trim() === "") {
        return invalid(reply, "project 必须是非空字符串");
      }
      project = query.project;
    }

    let kind: string | undefined;
    if (query.kind !== undefined) {
      if (typeof query.kind !== "string" || query.kind.trim() === "") {
        return invalid(reply, "kind 必须是非空字符串");
      }
      kind = query.kind;
    }

    const limit = parseLimit(query.limit);
    if (limit === undefined) {
      return invalid(reply, `limit 必须为 1~${LIST_LIMITS.max} 的整数`);
    }

    let before: { createdAt: number; id: string } | undefined;
    if (query.cursor !== undefined) {
      const parsed =
        typeof query.cursor === "string" ? parseKeysetCursor(query.cursor) : undefined;
      before = parsed === undefined ? undefined : { createdAt: parsed.sort, id: parsed.id };
      if (before === undefined) {
        return invalid(reply, "cursor 格式应为 <createdAt>:<id>");
      }
    }

    const result = await read.list({
      limit,
      ...(status === undefined ? {} : { status }),
      ...(stage === undefined ? {} : { stage }),
      ...(attention === undefined ? {} : { attention }),
      ...(project === undefined ? {} : { project }),
      ...(kind === undefined ? {} : { kind }),
      ...(before === undefined ? {} : { before }),
    });
    const last = result.items.at(-1);
    return {
      items: result.items.map(toListItem),
      nextCursor:
        result.hasMore && last !== undefined ? `${last.createdAt}:${last.id}` : null,
    };
  });

  app.get("/api/work-items/:id", { preHandler: requireSession(db, now) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await read.detail(id);
      return {
        workItem: toDetail(result.item),
        tasks: result.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          assignee: task.assignee,
          status: task.status,
          origin: task.origin,
          output: task.output,
          createdAt: task.createdAt,
        })),
        runs: result.runs.map((run) => ({
          id: run.id,
          agentId: run.agentId,
          status: run.status,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
        })),
        inbox: result.inbox.map((row) => ({
          id: row.id,
          kind: row.kind,
          targetAgentId: row.targetAgentId,
          status: row.status,
          taskId: row.taskId,
          leaseUntil: row.leaseUntil,
          reason: row.reason,
          createdAt: row.createdAt,
        })),
        threads: result.threadLinks.map((link) => ({
          subscriptionId: link.subscriptionId,
          threadId: link.threadId,
          source: link.source,
          externalKind: link.externalKind,
          externalKey: link.externalKey,
          mode: link.mode,
          revokedAt: link.revokedAt,
        })),
      };
    } catch (error) {
      if (error instanceof WorkError) {
        return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });

  app.get(
    "/api/work-items/:id/events",
    { preHandler: requireSession(db, now) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as Record<string, unknown>;

      const afterSeq = parseSeq(query.cursor);
      if (afterSeq === undefined) {
        return invalid(reply, "cursor 必须是非负整数 seq");
      }
      const limit = parseLimit(query.limit);
      if (limit === undefined) {
        return invalid(reply, `limit 必须为 1~${LIST_LIMITS.max} 的整数`);
      }

      try {
        const result = await read.events(id, { afterSeq, limit });
        const last = result.items.at(-1);
        return {
          items: result.items.map((event) => ({
            id: event.id,
            seq: event.seq,
            kind: event.kind,
            triggerId: event.triggerId,
            evidenceRefs: parseJsonObject(event.evidenceRefsJson),
            payload: parseJsonObject(event.payloadJson),
            occurredAt: event.occurredAt,
          })),
          nextCursor: result.hasMore && last !== undefined ? last.seq : null,
        };
      } catch (error) {
        if (error instanceof WorkError) {
          return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }
    },
  );
}
