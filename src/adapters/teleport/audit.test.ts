import { describe, expect, it } from "vitest";
import { createTeleportAuditAdapter } from "./audit.js";

const SAMPLE = [
  JSON.stringify({
    event: "session.start",
    sid: "sid-1",
    user: "bot-aw-agent1",
    login: "agentwork",
    server_hostname: "node-1",
    time: "2026-10-31T10:00:00Z",
    user_traits: { aw_task_id: ["task-0001"], aw_ticket_id: ["tkt_0001"] },
  }),
  "not-json",
  JSON.stringify({ event: "user.login", user: "x" }),
  JSON.stringify({
    event: "session.start",
    sid: "sid-2",
    user: "bot-aw-agent2",
    login: "agentwork",
    server_hostname: "node-2",
    time: "2026-10-31T11:00:00Z",
    user_traits: { aw_task_id: ["task-0002"] },
  }),
  "",
].join("\n");

describe("Teleport 审计适配器", () => {
  it("只提取 session.start,忽略坏行与其他事件", async () => {
    const adapter = createTeleportAuditAdapter(
      { auditLogPath: "/tmp/events.log" },
      { readFile: async () => SAMPLE },
    );
    const events = await adapter.listSessionStarts();
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      sid: "sid-1",
      user: "bot-aw-agent1",
      login: "agentwork",
      serverHostname: "node-1",
      taskId: "task-0001",
      ticketId: "tkt_0001",
      time: Date.parse("2026-10-31T10:00:00Z"),
    });
    expect(events[1]).toMatchObject({ sid: "sid-2", taskId: "task-0002", ticketId: null });
  });

  it("traits 缺失时回退到事件顶层字段", async () => {
    const line = JSON.stringify({
      event: "session.start",
      sid: "sid-3",
      time: "2026-10-31T12:00:00Z",
      aw_task_id: ["task-0003"],
      aw_ticket_id: ["tkt_0003"],
    });
    const adapter = createTeleportAuditAdapter(
      { auditLogPath: "/tmp/events.log" },
      { readFile: async () => line },
    );
    const [event] = await adapter.listSessionStarts();
    expect(event).toMatchObject({ taskId: "task-0003", ticketId: "tkt_0003" });
  });

  it("文件不可读时抛错,不返回空列表", async () => {
    const adapter = createTeleportAuditAdapter(
      { auditLogPath: "/nope/events.log" },
      {
        readFile: async () => {
          throw new Error("ENOENT");
        },
      },
    );
    await expect(adapter.listSessionStarts()).rejects.toThrow(/审计日志不可读/);
  });
});
