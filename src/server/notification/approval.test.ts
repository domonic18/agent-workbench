import { describe, expect, it } from "vitest";
import { createCapabilityService } from "../../domain/capability/service.js";
import { openDatabase } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { findOutboxByKey } from "../../store/repositories/outbox.js";
import { createApprovalNotifier } from "./approval.js";

function prepare() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  db.prepare(
    `INSERT INTO task
       (id, title, assigner, assignee, project, stage, status, origin, created_at, updated_at)
     VALUES ('T-1', '任务', 'a', 'b', 'aw', 'exec', 'running', 'a2a', 0, 0)`,
  ).run();
  return db;
}

describe("审批卡片通知", () => {
  it("申请落库后入队一张卡片,重复入队不产生第二张", () => {
    const db = prepare();
    const service = createCapabilityService({
      db,
      teleport: { async applyTaskTraits() {} },
    });
    const record = service.request({
      subject: "agent:codex",
      target: "db:prod",
      action: "read",
      scope: { schema: "public" },
      ttlSeconds: 900,
      taskId: "T-1",
      actor: "console",
    });

    const notify = createApprovalNotifier({ db, approvalChatId: "oc_approval", now: () => 1_000 });
    notify?.(record);
    notify?.(record);

    const row = findOutboxByKey(db, `cap:${record.id}:requested`);
    expect(row).toMatchObject({
      channel: "push",
      deliveryClass: "notification",
      kind: "capability_approval",
      status: "pending",
    });
    expect(JSON.parse(row!.payloadJson)).toMatchObject({
      chatId: "oc_approval",
      card: { schema: "2.0" },
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 1 });
    db.close();
  });

  it("未配置审批群时不生成通知器", () => {
    const db = prepare();
    expect(createApprovalNotifier({ db, approvalChatId: undefined })).toBeUndefined();
    db.close();
  });
});
