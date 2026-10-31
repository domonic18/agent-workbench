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
  request(input: CapabilityRequestInput): CapabilityRecord;
  find(id: string): CapabilityRecord | undefined;
  approve(id: string, actor: string): Promise<CapabilityDecision>;
  reject(id: string, actor: string, reason?: string): CapabilityDecision;
  revoke(id: string, actor: string, reason?: string): CapabilityDecision;
  list(query: Parameters<typeof listCapabilities>[1]): CapabilityRecord[];
  expireStalePending(): number;
  reconcileStaleIssuing(): number;
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

function requireCapability(db: Db, id: string): CapabilityRecord {
  const row = findCapability(db, id);
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

  function request(input: CapabilityRequestInput): CapabilityRecord {
    const { ttlSeconds, scopeJson } = validateRequest(input);
    if (findTaskSummary(db, input.taskId) === undefined) {
      throw new CapabilityError("VALIDATION_FAILED", "授权必须挂到已存在的任务", [
        `taskId: ${input.taskId}`,
      ]);
    }
    const id = newId();
    const createdAt = now();
    db.transaction(() => {
      insertCapability(db, {
        id,
        subject: input.subject,
        target: input.target.trim(),
        action: input.action as CapabilityAction,
        scopeJson,
        ttlSeconds,
        taskId: input.taskId,
        createdAt,
      });
      appendCapabilityAudit(db, {
        capabilityId: id,
        action: "requested",
        actor: input.actor,
        detail: { target: input.target.trim(), action: input.action, ttlSeconds },
        occurredAt: createdAt,
      });
    })();
    return requireCapability(db, id);
  }

  async function approve(id: string, actor: string): Promise<CapabilityDecision> {
    const row = requireCapability(db, id);
    if (row.status !== "pending") {
      return { applied: false, capability: row };
    }

    const ticketId = newTicketId();
    const approvedAt = now();
    const moved = db.transaction(() => {
      const applied = transitionCapability(db, {
        id,
        from: "pending",
        to: "issuing",
        now: approvedAt,
        ticketId,
      });
      if (!applied) {
        return false;
      }
      appendCapabilityAudit(db, {
        capabilityId: id,
        action: "approved",
        actor,
        detail: { ticketId },
        occurredAt: approvedAt,
      });
      return true;
    })();
    if (!moved) {
      return { applied: false, capability: requireCapability(db, id) };
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
      db.transaction(() => {
        const applied = transitionCapability(db, {
          id,
          from: "issuing",
          to: "rejected",
          now: failedAt,
        });
        // 对账可能已先把 issuing 收敛为 rejected;此时不再补记第二次迁移
        if (applied) {
          appendCapabilityAudit(db, {
            capabilityId: id,
            action: "issue_failed",
            actor,
            detail: { message: error instanceof Error ? error.message : String(error) },
            occurredAt: failedAt,
          });
        }
      })();
      throw new CapabilityError(
        "UPSTREAM_UNAVAILABLE",
        "Teleport 签发失败,授权已转「签发失败」,可重新提交申请",
      );
    }

    const issuedAt = now();
    const activated = db.transaction(() => {
      const applied = transitionCapability(db, {
        id,
        from: "issuing",
        to: "active",
        now: issuedAt,
        issuedAt,
        expiresAt: issuedAt + row.ttlSeconds * 1000,
      });
      if (applied) {
        appendCapabilityAudit(db, {
          capabilityId: id,
          action: "issued",
          actor,
          detail: { ticketId, expiresAt: issuedAt + row.ttlSeconds * 1000 },
          occurredAt: issuedAt,
        });
      }
      return applied;
    })();
    // 对账可能在签发途中把 issuing 收敛为 rejected;此时不能再宣称已生效
    return { applied: activated, capability: requireCapability(db, id) };
  }

  function reject(id: string, actor: string, reason?: string): CapabilityDecision {
    const row = requireCapability(db, id);
    if (row.status !== "pending") {
      return { applied: false, capability: row };
    }
    const decidedAt = now();
    const applied = db.transaction(() => {
      const moved = transitionCapability(db, {
        id,
        from: "pending",
        to: "rejected",
        now: decidedAt,
      });
      if (!moved) {
        return false;
      }
      appendCapabilityAudit(db, {
        capabilityId: id,
        action: "rejected",
        actor,
        detail: reason === undefined ? {} : { reason },
        occurredAt: decidedAt,
      });
      return true;
    })();
    return { applied, capability: requireCapability(db, id) };
  }

  function revoke(id: string, actor: string, reason?: string): CapabilityDecision {
    const row = requireCapability(db, id);
    if (row.status !== "active") {
      return { applied: false, capability: row };
    }
    const revokedAt = now();
    const applied = db.transaction(() => {
      const moved = transitionCapability(db, {
        id,
        from: "active",
        to: "revoked",
        now: revokedAt,
        revokedAt,
      });
      if (!moved) {
        return false;
      }
      appendCapabilityAudit(db, {
        capabilityId: id,
        action: "revoked",
        actor,
        detail: reason === undefined ? {} : { reason },
        occurredAt: revokedAt,
      });
      return true;
    })();
    return { applied, capability: requireCapability(db, id) };
  }

  /** 待批超 24h 条件更新为 rejected(01 §9:每 10 分钟一次) */
  function expireStalePending(): number {
    const at = now();
    let expired = 0;
    for (const row of findStalePending(db, at - CAPABILITY_TIMEOUTS.pendingMs)) {
      const applied = db.transaction(() => {
        if (
          !transitionCapability(db, {
            id: row.id,
            from: "pending",
            to: "rejected",
            now: at,
          })
        ) {
          return false;
        }
        appendCapabilityAudit(db, {
          capabilityId: row.id,
          action: "rejected",
          actor: "system",
          detail: { reason: "pending_timeout" },
          occurredAt: at,
        });
        return true;
      })();
      if (applied) {
        expired += 1;
      }
    }
    return expired;
  }

  /** issuing 超 60s 的补偿出口固定为 rejected(05 §5:每 60s 一次) */
  function reconcileStaleIssuing(): number {
    const at = now();
    let reconciled = 0;
    for (const row of findStaleIssuing(db, at - CAPABILITY_TIMEOUTS.issuingMs)) {
      const applied = db.transaction(() => {
        if (
          !transitionCapability(db, {
            id: row.id,
            from: "issuing",
            to: "rejected",
            now: at,
          })
        ) {
          return false;
        }
        appendCapabilityAudit(db, {
          capabilityId: row.id,
          action: "reconciled",
          actor: "system",
          detail: { reason: "issuing_timeout", ticketId: row.ticketId },
          occurredAt: at,
        });
        return true;
      })();
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
