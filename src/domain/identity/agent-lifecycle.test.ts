import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { createAgentLifecycleService, type AgentLifecycleService } from "./agent-lifecycle.js";
import { IdentityError } from "./errors.js";

async function prepare(): Promise<{ db: Db; service: AgentLifecycleService }> {
  const db = await openDatabase();
  const service = createAgentLifecycleService({ db, now: () => 1_000 });
  return { db, service };
}

async function expectCode(fn: () => Promise<unknown>, code: IdentityError["code"]): Promise<void> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(IdentityError);
    expect((error as IdentityError).code).toBe(code);
    return;
  }
  throw new Error(`预期抛出 ${code}`);
}

async function seed(db: Db): Promise<void> {
  await db.run(
    "INSERT INTO machine (id, hostname, display_name, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h1', '主机一', 'linux', '1', 'h', 'active', 0)",
  );
  await db.run(
    "INSERT INTO machine (id, hostname, display_name, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m2', 'h2', '主机二', 'linux', '1', 'h', 'active', 0)",
  );
  await db.run(
    `INSERT INTO agent (id, machine_id, runtime, project, display_name, secret_hash, status,
       allowed_targets_json, created_at, updated_at)
     VALUES ('agt_cc', 'm1', 'claude_code', 'p1', 'Claude', 'h', 'active', '[]', 0, 0)`,
  );
  await db.run(
    `INSERT INTO agent (id, machine_id, runtime, project, display_name, secret_hash, status,
       allowed_targets_json, key, created_at, updated_at)
     VALUES ('agt_wb', NULL, 'workbuddy', 'p2', '小W', 'h', 'active', '[]', 'wb-p2', 0, 0)`,
  );
}

describe("Agent 机器绑定", () => {
  it("外部运行时可绑定宿主机器,运行时与 key 不变", async () => {
    const { db, service } = await prepare();
    await seed(db);

    const agent = await service.updateAgent("agt_wb", { machineId: "m2" });
    expect(agent.machineId).toBe("m2");
    expect(agent.runtime).toBe("workbuddy");
    expect(agent.key).toBe("wb-p2");
    await db.close();
  });

  it("外部运行时可解绑机器", async () => {
    const { db, service } = await prepare();
    await seed(db);
    await service.updateAgent("agt_wb", { machineId: "m2" });

    const agent = await service.updateAgent("agt_wb", { machineId: null });
    expect(agent.machineId).toBeNull();
    await db.close();
  });

  it("claude_code 不可解绑机器:该机 aw-node 是采集与调度的前提", async () => {
    const { db, service } = await prepare();
    await seed(db);
    await expectCode(() => service.updateAgent("agt_cc", { machineId: null }), "VALIDATION_FAILED");
    await db.close();
  });

  it("绑定到未注册机器返回 NOT_FOUND", async () => {
    const { db, service } = await prepare();
    await seed(db);
    await expectCode(() => service.updateAgent("agt_wb", { machineId: "m_ghost" }), "NOT_FOUND");
    await db.close();
  });

  it("同机同项目冲突:绑定到已有同项目 Agent 的机器返回 CONFLICT", async () => {
    const { db, service } = await prepare();
    await seed(db);
    await db.run(
      `INSERT INTO agent (id, machine_id, runtime, project, display_name, secret_hash, status,
         allowed_targets_json, created_at, updated_at)
       VALUES ('agt_other', 'm2', 'claude_code', 'p2', '别的 Agent', 'h', 'active', '[]', 0, 0)`,
    );
    await expectCode(() => service.updateAgent("agt_wb", { machineId: "m2" }), "CONFLICT");
    await db.close();
  });

  it("换机器后项目撞车同样拦下", async () => {
    const { db, service } = await prepare();
    await seed(db);
    await db.run(
      `INSERT INTO agent (id, machine_id, runtime, project, display_name, secret_hash, status,
         allowed_targets_json, created_at, updated_at)
       VALUES ('agt_other', 'm2', 'claude_code', 'p2', '别的 Agent', 'h', 'active', '[]', 0, 0)`,
    );
    await expectCode(
      () => service.updateAgent("agt_wb", { machineId: "m2", project: "p2" }),
      "CONFLICT",
    );
    await db.close();
  });
});
