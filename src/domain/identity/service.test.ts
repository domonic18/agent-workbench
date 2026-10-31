import { describe, expect, it } from "vitest";
import { verifySecret } from "../security/secrets.js";
import { openDatabase } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import type { Db } from "../../store/database.js";
import { IdentityError } from "./errors.js";
import { createIdentityService, type IdentityService } from "./service.js";

function prepare(): { db: Db; service: IdentityService } {
  const db = openDatabase(":memory:");
  runMigrations(db);
  let agentSeq = 0;
  let secretSeq = 0;
  const service = createIdentityService({
    db,
    now: () => 1_000,
    newAgentId: () => `agt_${++agentSeq}`,
    newSecret: () => `secret-${++secretSeq}`,
  });
  return { db, service };
}

function expectCode(fn: () => unknown, code: IdentityError["code"]): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(IdentityError);
    expect((error as IdentityError).code).toBe(code);
    return;
  }
  throw new Error(`预期抛出 ${code}`);
}

describe("身份注册", () => {
  it("注册机器:明文只出现在返回值,库中只有哈希", () => {
    const { db, service } = prepare();
    const { machine, secret } = service.registerMachine({
      id: "macmini-01",
      hostname: "macmini.local",
      os: "darwin",
      collectorVersion: "0.1.0",
    });

    expect(machine.id).toBe("macmini-01");
    expect(secret).toBe("secret-1");
    expect(machine.collectorSecretHash).not.toBe(secret);
    expect(verifySecret(secret, machine.collectorSecretHash)).toBe(true);
    db.close();
  });

  it("重复机器 id 返回 409 语义", () => {
    const { db, service } = prepare();
    const input = { id: "m1", hostname: "h", os: "linux", collectorVersion: "1" };
    service.registerMachine(input);
    expectCode(() => service.registerMachine(input), "CONFLICT");
    db.close();
  });

  it("注册 Agent:机器必须存在,allowedTargets 去重后入库", () => {
    const { db, service } = prepare();
    expectCode(
      () =>
        service.registerAgent({
          machineId: "missing",
          project: "aw",
          displayName: "A",
        }),
      "NOT_FOUND",
    );

    service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    const { agent, secret } = service.registerAgent({
      machineId: "m1",
      project: "aw",
      displayName: "Agent A",
      allowedTargets: ["agt_9", "agt_9", "agt_8"],
    });
    expect(agent.id).toBe("agt_1");
    expect(verifySecret(secret, agent.secretHash)).toBe(true);
    expect(JSON.parse(agent.allowedTargetsJson)).toEqual(["agt_9", "agt_8"]);
    db.close();
  });

  it("同机器同项目冲突,不同项目可注册", () => {
    const { db, service } = prepare();
    service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    service.registerAgent({ machineId: "m1", project: "aw", displayName: "A" });

    expectCode(
      () => service.registerAgent({ machineId: "m1", project: "aw", displayName: "B" }),
      "CONFLICT",
    );
    expect(
      service.registerAgent({ machineId: "m1", project: "other", displayName: "B" }).agent.project,
    ).toBe("other");
    db.close();
  });

  it("轮换后旧密钥立即失效", () => {
    const { db, service } = prepare();
    service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    const first = service.registerAgent({ machineId: "m1", project: "aw", displayName: "A" });

    const rotated = service.rotateAgentSecret(first.agent.id);
    expect(rotated.secret).not.toBe(first.secret);
    expect(verifySecret(first.secret, rotated.agent.secretHash)).toBe(false);
    expect(verifySecret(rotated.secret, rotated.agent.secretHash)).toBe(true);

    const machine = service.registerMachine({
      id: "m2",
      hostname: "h",
      os: "linux",
      collectorVersion: "1",
    });
    const machineRotated = service.rotateMachineSecret(machine.machine.id);
    expect(verifySecret(machine.secret, machineRotated.machine.collectorSecretHash)).toBe(false);
    expect(
      verifySecret(machineRotated.secret, machineRotated.machine.collectorSecretHash),
    ).toBe(true);
    db.close();
  });

  it("轮换未知 id 返回 404 语义", () => {
    const { db, service } = prepare();
    expectCode(() => service.rotateAgentSecret("agt_missing"), "NOT_FOUND");
    expectCode(() => service.rotateMachineSecret("missing"), "NOT_FOUND");
    db.close();
  });

  it("字段校验:空值、超长、超量都拒绝", () => {
    const { db, service } = prepare();
    expectCode(
      () =>
        service.registerMachine({ id: " ", hostname: "h", os: "linux", collectorVersion: "1" }),
      "VALIDATION_FAILED",
    );
    service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    expectCode(
      () =>
        service.registerAgent({
          machineId: "m1",
          project: "x".repeat(129),
          displayName: "A",
        }),
      "VALIDATION_FAILED",
    );
    expectCode(
      () =>
        service.registerAgent({
          machineId: "m1",
          project: "aw",
          displayName: "A",
          allowedTargets: Array.from({ length: 65 }, (_, index) => `agt_${index}`),
        }),
      "VALIDATION_FAILED",
    );
    db.close();
  });

  it("列表返回注册结果", () => {
    const { db, service } = prepare();
    service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    service.registerAgent({ machineId: "m1", project: "aw", displayName: "A" });

    expect(service.listMachines({ limit: 10 }).map((row) => row.id)).toEqual(["m1"]);
    expect(service.listAgents({ limit: 10 }).map((row) => row.project)).toEqual(["aw"]);
    db.close();
  });
});
