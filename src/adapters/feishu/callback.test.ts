import * as Lark from "@larksuiteoapi/node-sdk";
import { describe, expect, it } from "vitest";
import { CapabilityError } from "../../domain/capability/errors.js";
import { handleCardCallback, toCardAction, type CardCallbackDeps } from "./callback.js";

const silentLogger = { info() {}, warn() {}, error() {} };

function makeDeps(overrides: Partial<CardCallbackDeps> = {}) {
  const calls = {
    approve: [] as [string, string][],
    reject: [] as [string, string, string | undefined][],
    claimed: [] as string[],
  };
  const deps: CardCallbackDeps = {
    isAllowed: (openId) => openId === "ou_1",
    claimEvent: (eventId, eventType) => {
      calls.claimed.push(`${eventId}:${eventType}`);
      return true;
    },
    service: {
      async approve(id, actor) {
        calls.approve.push([id, actor]);
        return { applied: true, capability: {} as never };
      },
      reject(id, actor, reason) {
        calls.reject.push([id, actor, reason]);
        return { applied: true, capability: {} as never };
      },
      find: () => undefined,
    },
    log: silentLogger,
    ...overrides,
  };
  return { deps, calls };
}

/** 长连接经 EventDispatcher.parse 铺平后的形状:header 与 event 字段都在顶层 */
function cardData(overrides: Record<string, unknown> = {}) {
  return {
    schema: "2.0",
    event_id: "ev_1",
    create_time: String(Date.now()),
    operator: { open_id: "ou_1" },
    action: { value: { capabilityId: "cap_1", decision: "approve" } },
    ...overrides,
  };
}

describe("toCardAction", () => {
  it("拍平载荷取事件、时间、操作人与 value", () => {
    expect(toCardAction(cardData())).toEqual({
      eventId: "ev_1",
      createTime: expect.any(Number),
      openId: "ou_1",
      value: { capabilityId: "cap_1", decision: "approve" },
    });
  });

  it("缺 event_id 返回 undefined", () => {
    expect(toCardAction({ operator: { open_id: "ou_1" } })).toBeUndefined();
  });
});

describe("长连接派发", () => {
  it("EventDispatcher 拍平 v2 卡片载荷后交给 card.action.trigger", async () => {
    const seen: unknown[] = [];
    const dispatcher = new Lark.EventDispatcher({ loggerLevel: Lark.LoggerLevel.error });
    dispatcher.register({
      "card.action.trigger": (data: unknown) => {
        seen.push(data);
      },
    });

    await dispatcher.invoke(
      {
        schema: "2.0",
        header: {
          event_id: "ev_1",
          event_type: "card.action.trigger",
          token: "vt",
          create_time: String(Date.now()),
        },
        event: {
          operator: { open_id: "ou_1" },
          action: { value: { capabilityId: "cap_1", decision: "approve" } },
        },
      },
      { needCheck: false },
    );

    expect(seen).toHaveLength(1);
    expect(toCardAction(seen[0])).toMatchObject({
      eventId: "ev_1",
      openId: "ou_1",
      value: { capabilityId: "cap_1", decision: "approve" },
    });
  });
});

describe("handleCardCallback", () => {
  it("事件时间戳超出窗口拒绝", async () => {
    const { deps, calls } = makeDeps();
    const result = await handleCardCallback(
      deps,
      cardData({ create_time: String(Date.now() - 25 * 60 * 60 * 1000) }),
    );
    expect(result.outcome).toBe("expired");
    expect(calls.approve).toHaveLength(0);
  });

  it("微秒级时间戳归一后通过", async () => {
    const { deps, calls } = makeDeps();
    const result = await handleCardCallback(
      deps,
      cardData({ create_time: String(Date.now() * 1000) }),
    );
    expect(result.outcome).toBe("handled");
    expect(calls.approve).toEqual([["cap_1", "ou_1"]]);
  });

  it("微秒级时间戳超窗仍拒绝", async () => {
    const { deps } = makeDeps();
    const result = await handleCardCallback(
      deps,
      cardData({ create_time: String((Date.now() - 25 * 60 * 60 * 1000) * 1000) }),
    );
    expect(result.outcome).toBe("expired");
  });

  it("缺时间戳拒绝", async () => {
    const { deps } = makeDeps();
    const result = await handleCardCallback(deps, cardData({ create_time: undefined }));
    expect(result.outcome).toBe("expired");
  });

  it("缺 event_id 视为非法载荷", async () => {
    const { deps, calls } = makeDeps();
    const result = await handleCardCallback(deps, cardData({ event_id: undefined }));
    expect(result.outcome).toBe("invalid");
    expect(calls.claimed).toHaveLength(0);
  });

  it("非白名单用户拒绝且不认领事件", async () => {
    const { deps, calls } = makeDeps();
    const result = await handleCardCallback(
      deps,
      cardData({ operator: { open_id: "ou_evil" } }),
    );
    expect(result.outcome).toBe("denied");
    expect(calls.approve).toHaveLength(0);
    expect(calls.claimed).toHaveLength(0);
  });

  it("重复 event_id 幂等跳过", async () => {
    const { deps, calls } = makeDeps({ claimEvent: () => false });
    const result = await handleCardCallback(deps, cardData());
    expect(result.outcome).toBe("duplicate");
    expect(calls.claimed).toHaveLength(0);
    expect(calls.approve).toHaveLength(0);
  });

  it("重复点击带上当前快照,供迟到重试刷新卡片", async () => {
    const { deps } = makeDeps({
      claimEvent: () => false,
      service: {
        async approve() {
          throw new Error("重复事件不应调用服务");
        },
        reject() {
          throw new Error("重复事件不应调用服务");
        },
        find: () => ({ id: "cap_1", status: "rejected" }) as never,
      },
    });
    const result = await handleCardCallback(deps, cardData());
    expect(result.outcome).toBe("duplicate");
    expect(result.capability).toMatchObject({ id: "cap_1", status: "rejected" });
  });

  it("批准以审批人 open_id 记账", async () => {
    const { deps, calls } = makeDeps();
    const result = await handleCardCallback(deps, cardData());
    expect(result.outcome).toBe("handled");
    expect(result.decision).toBe("approve");
    expect(result.actor).toBe("ou_1");
    expect(calls.approve).toEqual([["cap_1", "ou_1"]]);
    expect(calls.claimed).toEqual(["ev_1:card.action.trigger"]);
  });

  it("拒绝带原因调用服务", async () => {
    const { deps, calls } = makeDeps();
    const result = await handleCardCallback(
      deps,
      cardData({
        action: { value: { capabilityId: "cap_1", decision: "reject", reason: "范围过大" } },
      }),
    );
    expect(result.outcome).toBe("handled");
    expect(result.decision).toBe("reject");
    expect(calls.reject).toEqual([["cap_1", "ou_1", "范围过大"]]);
  });

  it("非法 decision 拒绝", async () => {
    const { deps } = makeDeps();
    const result = await handleCardCallback(
      deps,
      cardData({ action: { value: { capabilityId: "cap_1", decision: "maybe" } } }),
    );
    expect(result.outcome).toBe("invalid");
  });

  it("服务抛 CapabilityError 时记为 failed 并带上错误码", async () => {
    const { deps } = makeDeps({
      service: {
        async approve() {
          throw new CapabilityError("NOT_FOUND", "授权记录不存在");
        },
        reject() {
          throw new CapabilityError("NOT_FOUND", "授权记录不存在");
        },
        find: () => undefined,
      },
    });
    const result = await handleCardCallback(deps, cardData());
    expect(result.outcome).toBe("failed");
    expect(result.errorCode).toBe("NOT_FOUND");
  });
});
