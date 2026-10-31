import { CapabilityError } from "../../domain/capability/errors.js";
import type { CapabilityService } from "../../domain/capability/service.js";
import { FEISHU_EVENT_WINDOW } from "../../shared/constants.js";
import type { InboundLogger } from "./inbound.js";

/** 授权记录快照:裁决后用于把卡片刷新成终态 */
export type CapabilitySnapshot = NonNullable<ReturnType<CapabilityService["find"]>>;

export interface CardCallbackDeps {
  isAllowed(openId: string): boolean;
  claimEvent(eventId: string, eventType: string): boolean;
  service: Pick<CapabilityService, "approve" | "reject" | "find">;
  log: InboundLogger;
}

/** handled=已裁决;duplicate=重复或已处理;denied=非白名单;invalid=载荷不合法;expired=超时间窗;failed=裁决异常 */
export type CardCallbackOutcome =
  | "handled"
  | "duplicate"
  | "denied"
  | "invalid"
  | "expired"
  | "failed";

export interface CardCallbackResult {
  outcome: CardCallbackOutcome;
  capabilityId?: string;
  actor?: string;
  decision?: "approve" | "reject";
  /** 裁决后的授权快照;存在时调用方应把卡片更新成对应终态 */
  capability?: CapabilitySnapshot;
  errorCode?: string;
}

const EVENT_TYPE = "card.action.trigger";

/** EventDispatcher.parse 已把 v2 载荷的 header/event 铺平到顶层,这里按拍平后的形状取字段 */
interface CardActionPayload {
  event_id?: unknown;
  create_time?: unknown;
  operator?: { open_id?: unknown };
  action?: { value?: { capabilityId?: unknown; decision?: unknown; reason?: unknown } };
}

export interface CardActionInput {
  eventId: string;
  createTime: number | undefined;
  openId: string | undefined;
  value: { capabilityId?: unknown; decision?: unknown; reason?: unknown };
}

/** 卡片回调的 header.create_time 是微秒级字符串;普通事件是毫秒,按量级归一为毫秒 */
const MICROSECOND_THRESHOLD = 1e14;

function parseTime(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed > MICROSECOND_THRESHOLD ? Math.floor(parsed / 1000) : parsed;
}

function inWindow(createTime: number | undefined, now: number): boolean {
  if (createTime === undefined) {
    return false;
  }
  return (
    createTime - now <= FEISHU_EVENT_WINDOW.maxFutureSkewMs &&
    now - createTime <= FEISHU_EVENT_WINDOW.maxAgeMs
  );
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** 长连接卡片回调 → 裁决输入;缺 event_id 视为非法载荷 */
export function toCardAction(data: unknown): CardActionInput | undefined {
  const raw = (data ?? {}) as CardActionPayload;
  const eventId = nonEmptyString(raw.event_id);
  if (eventId === undefined) {
    return undefined;
  }
  return {
    eventId,
    createTime: parseTime(raw.create_time),
    openId: typeof raw.operator?.open_id === "string" ? raw.operator.open_id : undefined,
    value: raw.action?.value ?? {},
  };
}

/**
 * 卡片裁决(01 §8):时间窗 → open_id 白名单 → event_id 去重 → 调授权服务。
 * 事件经应用凭据认证的长连接送达,不再比对 Verification Token;审批 actor 记审批人 open_id。
 * 返回结构供调用方构造 toast 与终态卡片(Duplicate 时也带快照,便于迟到重试刷新界面)。
 */
export async function handleCardCallback(
  deps: CardCallbackDeps,
  data: unknown,
  now: number = Date.now(),
): Promise<CardCallbackResult> {
  const event = toCardAction(data);
  if (event === undefined) {
    deps.log.warn({}, "飞书卡片回调缺 event_id,丢弃");
    return { outcome: "invalid" };
  }

  if (!inWindow(event.createTime, now)) {
    deps.log.warn({ eventId: event.eventId }, "飞书卡片回调时间戳超出窗口,丢弃");
    return { outcome: "expired" };
  }

  if (event.openId === undefined || !deps.isAllowed(event.openId)) {
    deps.log.warn({ eventId: event.eventId, openId: event.openId }, "非白名单用户点击审批卡片,拒绝");
    return { outcome: "denied" };
  }

  const capabilityId = nonEmptyString(event.value.capabilityId);
  const actor = event.openId;

  if (!deps.claimEvent(event.eventId, EVENT_TYPE)) {
    deps.log.info({ eventId: event.eventId }, "重复卡片回调,跳过");
    const capability = capabilityId === undefined ? undefined : deps.service.find(capabilityId);
    return {
      outcome: "duplicate",
      ...(capabilityId === undefined ? {} : { capabilityId }),
      actor,
      ...(capability === undefined ? {} : { capability }),
    };
  }

  const { decision, reason } = event.value;
  if (capabilityId === undefined || (decision !== "approve" && decision !== "reject")) {
    deps.log.warn({ eventId: event.eventId, capabilityId, decision }, "卡片回调载荷不合法,丢弃");
    return {
      outcome: "invalid",
      ...(capabilityId === undefined ? {} : { capabilityId }),
      actor,
    };
  }

  try {
    const result =
      decision === "approve"
        ? await deps.service.approve(capabilityId, actor)
        : deps.service.reject(
            capabilityId,
            actor,
            typeof reason === "string" ? reason : undefined,
          );
    deps.log.info(
      {
        eventId: event.eventId,
        capabilityId,
        openId: actor,
        decision,
        applied: result.applied,
      },
      decision === "approve" ? "飞书卡片批准已处理" : "飞书卡片拒绝已处理",
    );
    return {
      outcome: result.applied ? "handled" : "duplicate",
      capabilityId,
      actor,
      decision,
      capability: result.capability,
    };
  } catch (error) {
    if (error instanceof CapabilityError) {
      deps.log.warn({ eventId: event.eventId, capabilityId, code: error.code }, "飞书卡片裁决失败");
    } else {
      deps.log.error({ err: error, eventId: event.eventId }, "飞书卡片裁决异常");
    }
    const capability = deps.service.find(capabilityId);
    return {
      outcome: "failed",
      capabilityId,
      actor,
      decision,
      ...(error instanceof CapabilityError ? { errorCode: error.code } : {}),
      ...(capability === undefined ? {} : { capability }),
    };
  }
}
