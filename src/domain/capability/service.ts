import { randomBytes } from "node:crypto";
import type { TeleportAdapter } from "../../adapters/teleport/tctl.js";
import { CAPABILITY_TIMEOUTS, type CapabilityAction } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { findTaskSummary } from "../../store/repositories/task.js";
import {
  appendCapabilityAudit,
  findCapability,
  findStaleIssuing,
  findStalePending,
  insertCapability,
  listCapabilities,
  transitionCapability,
  type CapabilityRecord,
} from "../../store/repositories/capability.js";
import { CapabilityError } from "./errors.js";
import { deriveBotName } from "./identity.js";
import { validateRequest, type CapabilityRequestInput } from "./request-validation.js";

export interface CapabilityService {
  request(input: CapabilityRequestInput): Promise<CapabilityRecord>;
  find(id: string): Promise<CapabilityRecord | undefined>;
  approve(id: string, actor: string): Promise<CapabilityDecision>;
  reject(id: string, actor: string, reason?: string): Promise<CapabilityDecision>;
  revoke(id: string, actor: string, reason?: string): Promise<CapabilityDecision>;
  list(query: Parameters<typeof listCapabilities>[1]): Promise<CapabilityRecord[]>;
  expireStalePending(): Promise<number>;
  reconcileStaleIssuing(): Promise<number>;
}

export interface CapabilityDecision {
  applied: boolean;
  capability: CapabilityRecord;
}

export interface CapabilityServiceDeps {
  db: Db;
  teleport: TeleportAdapter;
  now?: () => number;
  newId?: () => string;
  newTicketId?: () => string;
}

function defaultId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

async function requireCapability(db: Db, id: string): Promise<CapabilityRecord> {
  const row = await findCapability(db, id);
  if (row === undefined) {
    throw new CapabilityError("NOT_FOUND", "授权记录不存在");
  }
  return row;
}

export function createCapabilityService(deps: CapabilityServiceDeps): CapabilityService {
  const { db, teleport } = deps;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => defaultId("cap"));
  const newTicketId = deps.newTicketId ?? (() => defaultId("tkt"));

  async function request(input: CapabilityRequestInput): Promise<CapabilityRecord> {
    const { ttlSeconds, scopeJson } = validateRequest(input);
    if ((await findTaskSummary(db, input.taskId)) === undefined) {
      throw new CapabilityError("VALIDATION_FAILED", "授权必须挂到已存在的任务", [
        `taskId: ${input.taskId}`,
      ]);
    }
    const id = newId();
    const createdAt = now();
    await db.transaction(async (tx) => {
      await insertCapability(tx, {
        id,
        subject: input.subject,
        target: input.target.trim(),
        action: input.action as CapabilityAction,
        scopeJson,
        ttlSeconds,
        taskId: input.taskId,
        createdAt,
      });
      await appendCapabilityAudit(tx, {
        capabilityId: id,
        action: "requested",
        actor: input.actor,
        detail: { target: input.target.trim(), action: input.action, ttlSeconds },
        occurredAt: createdAt,
      });
    });
    return requireCapability(db, id);
  }

  async function approve(id: string, actor: string): Promise<CapabilityDecision> {
    const row = await requireCapability(db, id);
    if (row.status !== "pending") {
      return { applied: false, capability: row };
    }

    const ticketId = newTicketId();
    const approvedAt = now();
    const moved = await db.transaction(async (tx): Promise<boolean> => {
      const applied = await transitionCapability(tx, {
        id,
        from: "pending",
        to: "issuing",
        now: approvedAt,
        ticketId,
      });
      if (!applied) {
        return false;
      }
      await appendCapabilityAudit(tx, {
        capabilityId: id,
        action: "approved",
        actor,
        detail: { ticketId },
        occurredAt: approvedAt,
      });
      return true;
    });
    if (!moved) {
      return { applied: false, capability: await requireCapability(db, id) };
    }

    // saga:改状态与签发分属两个事务域,签发结果决定 issuing 落到 active 还是 rejected
    try {
      await teleport.applyTaskTraits({
        botName: deriveBotName(row.subject),
        taskId: row.taskId,
        ticketId,
      });
    } catch (error) {
      const failedAt = now();
      await db.transaction(async (tx) => {
        const applied = await transitionCapability(tx, {
          id,
          from: "issuing",
          to: "rejected",
          now: failedAt,
        });
        // 对账可能已先把 issuing 收敛为 rejected;此时不再补记第二次迁移
        if (applied) {
          await appendCapabilityAudit(tx, {
            capabilityId: id,
            action: "issue_failed",
            actor,
            detail: { message: error instanceof Error ? error.message : String(error) },
            occurredAt: failedAt,
          });
        }
      });
      throw new CapabilityError(
        "UPSTREAM_UNAVAILABLE",
        "Teleport 签发失败,授权已转「签发失败」,可重新提交申请",
      );
    }

    const issuedAt = now();
    const activated = await db.transaction(async (tx): Promise<boolean> => {
      const applied = await transitionCapability(tx, {
        id,
        from: "issuing",
        to: "active",
        now: issuedAt,
        issuedAt,
        expiresAt: issuedAt + row.ttlSeconds * 1000,
      });
      if (applied) {
        await appendCapabilityAudit(tx, {
          capabilityId: id,
          action: "issued",
          actor,
          detail: { ticketId, expiresAt: issuedAt + row.ttlSeconds * 1000 },
          occurredAt: issuedAt,
        });
      }
      return applied;
    });
    // 对账可能在签发途中把 issuing 收敛为 rejected;此时不能再宣称已生效
    return { applied: activated, capability: await requireCapability(db, id) };
  }

  async function reject(id: string, actor: string, reason?: string): Promise<CapabilityDecision> {
    const row = await requireCapability(db, id);
    if (row.status !== "pending") {
      return { applied: false, capability: row };
    }
    const decidedAt = now();
    const applied = await db.transaction(async (tx): Promise<boolean> => {
      const moved = await transitionCapability(tx, {
        id,
        from: "pending",
        to: "rejected",
        now: decidedAt,
      });
      if (!moved) {
        return false;
      }
      await appendCapabilityAudit(tx, {
        capabilityId: id,
        action: "rejected",
        actor,
        detail: reason === undefined ? {} : { reason },
        occurredAt: decidedAt,
      });
      return true;
    });
    return { applied, capability: await requireCapability(db, id) };
  }

  async function revoke(id: string, actor: string, reason?: string): Promise<CapabilityDecision> {
    const row = await requireCapability(db, id);
    if (row.status !== "active") {
      return { applied: false, capability: row };
    }
    const revokedAt = now();
    const applied = await db.transaction(async (tx): Promise<boolean> => {
      const moved = await transitionCapability(tx, {
        id,
        from: "active",
        to: "revoked",
        now: revokedAt,
        revokedAt,
      });
      if (!moved) {
        return false;
      }
      await appendCapabilityAudit(tx, {
        capabilityId: id,
        action: "revoked",
        actor,
        detail: reason === undefined ? {} : { reason },
        occurredAt: revokedAt,
      });
      return true;
    });
    return { applied, capability: await requireCapability(db, id) };
  }

  /** 待批超 24h 条件更新为 rejected(01 §9:每 10 分钟一次) */
  async function expireStalePending(): Promise<number> {
    const at = now();
    let expired = 0;
    for (const row of await findStalePending(db, at - CAPABILITY_TIMEOUTS.pendingMs)) {
      const applied = await db.transaction(async (tx): Promise<boolean> => {
        if (
          !(await transitionCapability(tx, {
            id: row.id,
            from: "pending",
            to: "rejected",
            now: at,
          }))
        ) {
          return false;
        }
        await appendCapabilityAudit(tx, {
          capabilityId: row.id,
          action: "rejected",
          actor: "system",
          detail: { reason: "pending_timeout" },
          occurredAt: at,
        });
        return true;
      });
      if (applied) {
        expired += 1;
      }
    }
    return expired;
  }

  /** issuing 超 60s 的补偿出口固定为 rejected(05 §5:每 60s 一次) */
  async function reconcileStaleIssuing(): Promise<number> {
    const at = now();
    let reconciled = 0;
    for (const row of await findStaleIssuing(db, at - CAPABILITY_TIMEOUTS.issuingMs)) {
      const applied = await db.transaction(async (tx): Promise<boolean> => {
        if (
          !(await transitionCapability(tx, {
            id: row.id,
            from: "issuing",
            to: "rejected",
            now: at,
          }))
        ) {
          return false;
        }
        await appendCapabilityAudit(tx, {
          capabilityId: row.id,
          action: "reconciled",
          actor: "system",
          detail: { reason: "issuing_timeout", ticketId: row.ticketId },
          occurredAt: at,
        });
        return true;
      });
      if (applied) {
        reconciled += 1;
      }
    }
    return reconciled;
  }

  return {
    request,
    find: (id) => findCapability(db, id),
    approve,
    reject,
    revoke,
    expireStalePending,
    reconcileStaleIssuing,
    list: (query) => listCapabilities(db, query),
  };
}
