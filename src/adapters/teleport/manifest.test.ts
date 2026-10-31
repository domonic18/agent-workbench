import { describe, expect, it } from "vitest";
import { renderBotManifest } from "./manifest.js";

const input = {
  botName: "aw-agent-codex",
  role: "aw-ext",
  maxSessionTtl: "12h",
  taskId: "tsk_20261031_01",
  ticketId: "cap_01j_ticket",
};

describe("renderBotManifest", () => {
  it("每任务两个 trait:aw_task_id 与 aw_ticket_id", () => {
    expect(renderBotManifest(input)).toBe(`kind: bot
version: v1
metadata:
  name: aw-agent-codex
spec:
  max_session_ttl: 12h
  roles: [aw-ext]
  traits:
    - name: aw_task_id
      values: ["tsk_20261031_01"]
    - name: aw_ticket_id
      values: ["cap_01j_ticket"]
`);
  });

  it("bot 名与 trait 值走白名单,拒绝 YAML 注入", () => {
    expect(() => renderBotManifest({ ...input, botName: "AW Agent" })).toThrow(/botName/);
    expect(() => renderBotManifest({ ...input, taskId: 'tsk"\ninjected' })).toThrow(/taskId/);
    expect(() => renderBotManifest({ ...input, ticketId: "cap 01j" })).toThrow(/ticketId/);
  });

  it("TTL 只接受短时长字面量,拒绝换行注入", () => {
    expect(() => renderBotManifest({ ...input, maxSessionTtl: "12h\n  extra: x" })).toThrow(
      /maxSessionTtl/,
    );
    expect(() => renderBotManifest({ ...input, maxSessionTtl: "0s" })).toThrow(/maxSessionTtl/);
  });
});
