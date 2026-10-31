import type * as Lark from "@larksuiteoapi/node-sdk";
import { describe, expect, it } from "vitest";
import type { CapabilitySnapshot } from "./callback.js";
import { buildApprovalCard, buildCardCallbackResponse, createCardSender } from "./card.js";

const input = {
  capabilityId: "cap_1",
  subject: "agent:codex",
  target: "db:prod",
  action: "read",
  ttlSeconds: 900,
  taskId: "T-1",
  scope: { schema: "public" },
};

function fakeClient(response: { code?: number; msg?: string } = { code: 0 }) {
  const calls: unknown[] = [];
  const client = {
    im: {
      message: {
        async create(args: unknown) {
          calls.push(args);
          return response;
        },
      },
    },
  } as unknown as Lark.Client;
  return { client, calls };
}

describe("buildApprovalCard", () => {
  it("生成带批准/拒绝按钮的卡片 v2", () => {
    const card = buildApprovalCard(input) as {
      schema: string;
      header: { title: { content: string } };
      body: { elements: unknown[] };
    };

    expect(card.schema).toBe("2.0");
    expect(card.header.title.content).toBe("授权申请待审批");

    const buttons = card.body.elements.filter(
      (element) => (element as { tag?: string }).tag === "button",
    ) as { behaviors: { type: string; value: { capabilityId: string; decision: string } }[] }[];
    expect(buttons.map((button) => button.behaviors[0]?.value)).toEqual([
      { capabilityId: "cap_1", decision: "approve" },
      { capabilityId: "cap_1", decision: "reject" },
    ]);
  });
});

function snapshot(overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    id: "cap_1",
    subject: "agent:codex",
    target: "db:prod",
    action: "read",
    scopeJson: JSON.stringify({ schema: "public" }),
    ttlSeconds: 900,
    status: "active",
    ticketId: "tkt_1",
    taskId: "T-1",
    issuedAt: 1,
    expiresAt: 1_800_000_000_000,
    revokedAt: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

interface ResolvedCardShape {
  header: { title: { content: string }; template: string };
  body: { elements: { tag?: string; content?: string }[] };
}

function cardOf(response: ReturnType<typeof buildCardCallbackResponse>): ResolvedCardShape {
  if (response.card === undefined) {
    throw new Error("响应里没有终态卡片");
  }
  expect(response.card.type).toBe("raw");
  return response.card.data as unknown as ResolvedCardShape;
}

describe("buildCardCallbackResponse", () => {
  it("批准成功:success toast + 绿色终态卡,按钮移除", () => {
    const response = buildCardCallbackResponse({
      outcome: "handled",
      capabilityId: "cap_1",
      actor: "ou_1",
      decision: "approve",
      capability: snapshot(),
    });

    expect(response.toast).toEqual({ type: "success", content: "已批准,授权已生效" });
    const card = cardOf(response);
    expect(card.header).toEqual({ title: { tag: "plain_text", content: "授权已生效" }, template: "green" });
    expect(card.body.elements.filter((element) => element.tag === "button")).toHaveLength(0);
    const text = card.body.elements.map((element) => element.content ?? "").join("\n");
    expect(text).toContain("**审批人**:ou_1");
    expect(text).toContain("**到期**:");
  });

  it("拒绝成功:success toast + 红色终态卡", () => {
    const response = buildCardCallbackResponse({
      outcome: "handled",
      capabilityId: "cap_1",
      actor: "ou_1",
      decision: "reject",
      capability: snapshot({ status: "rejected", expiresAt: null }),
    });

    expect(response.toast).toEqual({ type: "success", content: "已拒绝该申请" });
    const card = cardOf(response);
    expect(card.header.template).toBe("red");
    expect(card.header.title.content).toBe("授权已拒绝");
  });

  it("签发失败:error toast + 橙色终态卡", () => {
    const response = buildCardCallbackResponse({
      outcome: "failed",
      capabilityId: "cap_1",
      actor: "ou_1",
      decision: "approve",
      errorCode: "UPSTREAM_UNAVAILABLE",
      capability: snapshot({ status: "rejected", expiresAt: null }),
    });

    expect(response.toast).toEqual({ type: "error", content: "签发失败,授权已转拒绝" });
    const card = cardOf(response);
    expect(card.header.title.content).toBe("授权签发失败");
    expect(card.header.template).toBe("orange");
  });

  it("重复点击:info toast,仍按当前快照刷新卡片", () => {
    const response = buildCardCallbackResponse({
      outcome: "duplicate",
      capabilityId: "cap_1",
      actor: "ou_1",
      capability: snapshot({ status: "rejected", expiresAt: null }),
    });

    expect(response.toast).toEqual({ type: "info", content: "该申请已处理,无需重复操作" });
    expect(cardOf(response).header.title.content).toBe("授权已拒绝");
  });

  it.each([
    ["denied", "无权限操作该审批卡片"],
    ["invalid", "卡片数据不合法"],
    ["expired", "操作已过期,请重新发起申请"],
  ] as const)("%s 只弹 error toast,不改卡片", (outcome, content) => {
    const response = buildCardCallbackResponse({ outcome });
    expect(response.toast).toEqual({ type: "error", content });
    expect(response.card).toBeUndefined();
  });
});

describe("createCardSender", () => {
  it("按 chat_id 投递 interactive 消息", async () => {
    const { client, calls } = fakeClient();
    const sender = createCardSender(client);

    await sender.send({ chatId: "oc_1", card: { schema: "2.0" } });

    expect(calls).toEqual([
      {
        params: { receive_id_type: "chat_id" },
        data: { receive_id: "oc_1", msg_type: "interactive", content: JSON.stringify({ schema: "2.0" }) },
      },
    ]);
  });

  it("飞书返回非 0 code 时抛错", async () => {
    const { client } = fakeClient({ code: 400, msg: "bad request" });
    const sender = createCardSender(client);

    await expect(sender.send({ chatId: "oc_1", card: {} })).rejects.toThrow(/发送审批卡片失败/);
  });
});
