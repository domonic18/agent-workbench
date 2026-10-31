import { describe, expect, it, vi } from "vitest";
import {
  DENIED_RECEIPT,
  handleInboundMessage,
  type InboundDeps,
  type InboundMessage,
} from "./inbound.js";

const NOW = 1_700_000_000_000;
const MINUTE_MS = 60 * 1000;

function makeEvent(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    eventId: "evt_1",
    eventType: "im.message.receive_v1",
    token: "token",
    createTime: NOW,
    senderOpenId: "ou_allowed",
    senderType: "user",
    messageId: "om_1",
    chatId: "oc_1",
    chatType: "group",
    messageType: "text",
    content: '{"text":"查询任务"}',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<InboundDeps> = {}): InboundDeps {
  return {
    expectedToken: undefined,
    isAllowed: (openId) => openId === "ou_allowed",
    claimEvent: vi.fn(() => true),
    reply: vi.fn(async () => undefined),
    onCommand: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe("handleInboundMessage", () => {
  it("白名单首次事件交给指令解析,不自动回执", async () => {
    const deps = makeDeps();

    await expect(handleInboundMessage(deps, makeEvent(), NOW)).resolves.toBe("handled");
    expect(deps.claimEvent).toHaveBeenCalledWith("evt_1", "im.message.receive_v1");
    expect(deps.onCommand).toHaveBeenCalledOnce();
    expect(deps.reply).not.toHaveBeenCalled();
  });

  it("重复 event_id 直接跳过,不重复处理", async () => {
    const deps = makeDeps({ claimEvent: vi.fn(() => false) });

    await expect(handleInboundMessage(deps, makeEvent(), NOW)).resolves.toBe("duplicate");
    expect(deps.onCommand).not.toHaveBeenCalled();
  });

  it("非白名单回执无权限,且不认领事件(不入库)", async () => {
    const deps = makeDeps({ isAllowed: () => false });

    await expect(handleInboundMessage(deps, makeEvent(), NOW)).resolves.toBe("denied");
    expect(deps.reply).toHaveBeenCalledWith("om_1", DENIED_RECEIPT);
    expect(deps.claimEvent).not.toHaveBeenCalled();
  });

  it("缺 open_id 按非白名单处理", async () => {
    const deps = makeDeps();

    await expect(
      handleInboundMessage(deps, makeEvent({ senderOpenId: undefined }), NOW),
    ).resolves.toBe("denied");
    expect(deps.claimEvent).not.toHaveBeenCalled();
  });

  it("回执失败只记错误,不影响结果", async () => {
    const deps = makeDeps({
      isAllowed: () => false,
      reply: vi.fn(async () => {
        throw new Error("network");
      }),
    });

    await expect(handleInboundMessage(deps, makeEvent(), NOW)).resolves.toBe("denied");
    expect(deps.log.error).toHaveBeenCalledOnce();
  });

  it("超过 24 小时或超前 5 分钟的事件被丢弃", async () => {
    const stale = makeDeps();
    await expect(
      handleInboundMessage(stale, makeEvent({ createTime: NOW - 24 * 60 * MINUTE_MS - 1 }), NOW),
    ).resolves.toBe("rejected");
    expect(stale.claimEvent).not.toHaveBeenCalled();

    const future = makeDeps();
    await expect(
      handleInboundMessage(future, makeEvent({ createTime: NOW + 5 * MINUTE_MS + 1 }), NOW),
    ).resolves.toBe("rejected");
  });

  it("配置了来源 token 时比对不符即丢弃", async () => {
    const deps = makeDeps({ expectedToken: "expected" });

    await expect(handleInboundMessage(deps, makeEvent(), NOW)).resolves.toBe("rejected");
    expect(deps.claimEvent).not.toHaveBeenCalled();

    const ok = makeDeps({ expectedToken: "token" });
    await expect(handleInboundMessage(ok, makeEvent(), NOW)).resolves.toBe("handled");
  });
});
