import { describe, expect, it } from "vitest";
import { verifySecret } from "../security/secrets.js";
import { openDatabase, type Db } from "../../store/database.js";
import { IdentityError } from "./errors.js";
import { createIdentityService, type IdentityService } from "./service.js";

async function prepare(): Promise<{ db: Db; service: IdentityService }> {
  const db = await openDatabase();
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

describe("身份注册", () => {
  it("注册机器:明文只出现在返回值,库中只有哈希", async () => {
    const { db, service } = await prepare();
    const { machine, secret } = await service.registerMachine({
      id: "macmini-01",
      hostname: "macmini.local",
      os: "darwin",
      collectorVersion: "0.1.0",
    });

    expect(machine.id).toBe("macmini-01");
    expect(secret).toBe("secret-1");
    expect(machine.collectorSecretHash).not.toBe(secret);
    expect(verifySecret(secret, machine.collectorSecretHash)).toBe(true);
    await db.close();
  });

  it("重复机器 id 返回 409 语义", async () => {
    const { db, service } = await prepare();
    const input = { id: "m1", hostname: "h", os: "linux", collectorVersion: "1" };
    await service.registerMachine(input);
    await expectCode(() => service.registerMachine(input), "CONFLICT");
    await db.close();
  });

  it("注册 Agent:机器必须存在,allowedTargets 去重后入库", async () => {
    const { db, service } = await prepare();
    await expectCode(
      () =>
        service.registerAgent({
          machineId: "missing",
          project: "aw",
          displayName: "A",
        }),
      "NOT_FOUND",
    );

    await service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    const { agent, secret } = await service.registerAgent({
      machineId: "m1",
      project: "aw",
      displayName: "Agent A",
      allowedTargets: ["agt_9", "agt_9", "agt_8"],
    });
    expect(agent.id).toBe("agt_1");
    expect(verifySecret(secret, agent.secretHash)).toBe(true);
    expect(JSON.parse(agent.allowedTargetsJson)).toEqual(["agt_9", "agt_8"]);
    await db.close();
  });

  it("同机器同项目冲突,不同项目可注册", async () => {
    const { db, service } = await prepare();
    await service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    await service.registerAgent({ machineId: "m1", project: "aw", displayName: "A" });

    await expectCode(
      () => service.registerAgent({ machineId: "m1", project: "aw", displayName: "B" }),
      "CONFLICT",
    );
    expect(
      (await service.registerAgent({ machineId: "m1", project: "other", displayName: "B" })).agent
        .project,
    ).toBe("other");
    await db.close();
  });

  it("轮换后旧密钥立即失效", async () => {
    const { db, service } = await prepare();
    await service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    const first = await service.registerAgent({ machineId: "m1", project: "aw", displayName: "A" });

    const rotated = await service.rotateAgentSecret(first.agent.id);
    expect(rotated.secret).not.toBe(first.secret);
    expect(verifySecret(first.secret, rotated.agent.secretHash)).toBe(false);
    expect(verifySecret(rotated.secret, rotated.agent.secretHash)).toBe(true);

    const machine = await service.registerMachine({
      id: "m2",
      hostname: "h",
      os: "linux",
      collectorVersion: "1",
    });
    const machineRotated = await service.rotateMachineSecret(machine.machine.id);
    expect(verifySecret(machine.secret, machineRotated.machine.collectorSecretHash)).toBe(false);
    expect(
      verifySecret(machineRotated.secret, machineRotated.machine.collectorSecretHash),
    ).toBe(true);
    await db.close();
  });

  it("轮换未知 id 返回 404 语义", async () => {
    const { db, service } = await prepare();
    await expectCode(() => service.rotateAgentSecret("agt_missing"), "NOT_FOUND");
    await expectCode(() => service.rotateMachineSecret("missing"), "NOT_FOUND");
    await db.close();
  });

  it("字段校验:空值、超长、超量都拒绝", async () => {
    const { db, service } = await prepare();
    await expectCode(
      () =>
        service.registerMachine({ id: " ", hostname: "h", os: "linux", collectorVersion: "1" }),
      "VALIDATION_FAILED",
    );
    await service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    await expectCode(
      () =>
        service.registerAgent({
          machineId: "m1",
          project: "x".repeat(129),
          displayName: "A",
        }),
      "VALIDATION_FAILED",
    );
    await expectCode(
      () =>
        service.registerAgent({
          machineId: "m1",
          project: "aw",
          displayName: "A",
          allowedTargets: Array.from({ length: 65 }, (_, index) => `agt_${index}`),
        }),
      "VALIDATION_FAILED",
    );
    await db.close();
  });

  it("列表返回注册结果", async () => {
    const { db, service } = await prepare();
    await service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    await service.registerAgent({ machineId: "m1", project: "aw", displayName: "A" });

    expect((await service.listMachines({ limit: 10 })).map((row) => row.id)).toEqual(["m1"]);
    expect((await service.listAgents({ limit: 10 })).map((row) => row.project)).toEqual(["aw"]);
    await db.close();
  });
});

describe("委派白名单", () => {
  async function prepareAgents() {
    const context = await prepare();
    await context.service.registerMachine({
      id: "m1",
      hostname: "h",
      os: "linux",
      collectorVersion: "1",
    });
    const a = await context.service.registerAgent({ machineId: "m1", project: "a", displayName: "A" });
    const b = await context.service.registerAgent({ machineId: "m1", project: "b", displayName: "B" });
    const c = await context.service.registerAgent({ machineId: "m1", project: "c", displayName: "C" });
    return { ...context, a: a.agent, b: b.agent, c: c.agent };
  }

  it("保存去重后的目标,空数组清空", async () => {
    const { db, service, a, b, c } = await prepareAgents();
    const updated = await service.setAllowedTargets(a.id, [b.id, b.id, c.id]);
    expect(JSON.parse(updated.allowedTargetsJson)).toEqual([b.id, c.id]);

    const reloaded = (await service.listAgents({ limit: 10 })).find((row) => row.id === a.id);
    expect(reloaded === undefined ? null : JSON.parse(reloaded.allowedTargetsJson)).toEqual([
      b.id,
      c.id,
    ]);
    const cleared = await service.setAllowedTargets(a.id, []);
    expect(JSON.parse(cleared.allowedTargetsJson)).toEqual([]);
    await db.close();
  });

  it("自我委派、未知目标与未知发起方都拒绝", async () => {
    const { db, service, a } = await prepareAgents();
    await expectCode(() => service.setAllowedTargets(a.id, [a.id]), "VALIDATION_FAILED");
    await expectCode(() => service.setAllowedTargets(a.id, ["agt_missing"]), "VALIDATION_FAILED");
    await expectCode(() => service.setAllowedTargets("agt_missing", [a.id]), "NOT_FOUND");
    await db.close();
  });
});
