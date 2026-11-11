import { describe, expect, it } from "vitest";
import { verifySecret } from "../security/secrets.js";
import {
  consumeAgentEnrollToken,
  issueOneTimeToken,
} from "../bootstrap/one-time-token.js";
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
    expect(await verifySecret(secret, machine.collectorSecretHash)).toBe(true);
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
    expect(await verifySecret(secret, agent.secretHash as string)).toBe(true);
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
    expect(await verifySecret(first.secret, rotated.agent.secretHash as string)).toBe(false);
    expect(await verifySecret(rotated.secret, rotated.agent.secretHash as string)).toBe(true);

    const machine = await service.registerMachine({
      id: "m2",
      hostname: "h",
      os: "linux",
      collectorVersion: "1",
    });
    const machineRotated = await service.rotateMachineSecret(machine.machine.id);
    expect(await verifySecret(machine.secret, machineRotated.machine.collectorSecretHash)).toBe(false);
    expect(
      await verifySecret(machineRotated.secret, machineRotated.machine.collectorSecretHash),
    ).toBe(true);
    await db.close();
  });

  it("轮换 Agent 密钥联动清配置回执,新密钥必须能重新下达到机器(M3.11)", async () => {
    const { db, service } = await prepare();
    await service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    const first = await service.registerAgent({ machineId: "m1", project: "aw", displayName: "A" });
    // 模拟一次完整下发+ACK:此前 admin rotate 只换哈希不清回执,机器永远拉不到新密钥
    await db.run(
      "UPDATE agent SET config_version = 1, config_ack_at = 5_000 WHERE id = ?",
      first.agent.id,
    );

    const rotated = await service.rotateAgentSecret(first.agent.id);

    const row = (await db.get(
      'SELECT config_ack_at AS ack FROM agent WHERE id = ?',
      first.agent.id,
    )) as { ack: number | null };
    expect(row.ack).toBeNull();
    expect(rotated.agent.configVersion).toBe(1);
    await db.close();
  });

  it("轮换密钥作废该 Agent 在途的接入令牌,不影响他人", async () => {
    const { db, service } = await prepare();
    await service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    const target = await service.registerAgent({ machineId: "m1", project: "aw", displayName: "A" });
    const other = await service.registerAgent({ machineId: "m1", project: "pb", displayName: "B" });
    const issued = async (agentId: string): Promise<string> =>
      (
        await issueOneTimeToken(db, {
          purpose: "agent_enroll",
          subjectId: agentId,
          ttlMs: 60_000,
          now: () => 1_000,
        })
      ).token;
    const targetToken = await issued(target.agent.id);
    const otherToken = await issued(other.agent.id);

    await service.rotateAgentSecret(target.agent.id);

    expect(await consumeAgentEnrollToken(db, { token: targetToken, now: () => 2_000 })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(await consumeAgentEnrollToken(db, { token: otherToken, now: () => 2_000 })).toEqual({
      ok: true,
      agentId: other.agent.id,
    });
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

  it("注册机器无关 Agent:无 machineId,给定外部 runtime,machine_id 写 NULL", async () => {
    const { db, service } = await prepare();
    const { agent, secret } = await service.registerAgent({
      project: "workbuddy-proj",
      displayName: "WorkBuddy A",
      runtime: "workbuddy",
    });
    expect(agent.machineId).toBeNull();
    expect(agent.runtime).toBe("workbuddy");
    expect(secret).toBe("secret-1");
    expect(await verifySecret(secret, agent.secretHash as string)).toBe(true);
    await db.close();
  });

  it("机器无关 Agent 必须显式外部 runtime:缺省或 claude_code 都被拒", async () => {
    const { db, service } = await prepare();
    await expectCode(
      () => service.registerAgent({ project: "p", displayName: "A" }),
      "VALIDATION_FAILED",
    );
    await expectCode(
      () => service.registerAgent({ project: "p", displayName: "A", runtime: "claude_code" }),
      "VALIDATION_FAILED",
    );
    await db.close();
  });

  it("机器无关 Agent 同项目可注册多个(按 id 唯一,不强行项目去重)", async () => {
    const { db, service } = await prepare();
    const first = await service.registerAgent({ project: "p", displayName: "A", runtime: "workbuddy" });
    const second = await service.registerAgent({ project: "p", displayName: "B", runtime: "codex" });
    expect(first.agent.id).not.toBe(second.agent.id);
    expect(first.agent.machineId).toBeNull();
    expect(second.agent.runtime).toBe("codex");
    await db.close();
  });

  it("机器无关 Agent 可带稳定 key,重复占用 409;机器绑定 Agent 拒绝自报 key", async () => {
    const { db, service } = await prepare();
    const { agent } = await service.registerAgent({
      project: "workbuddy-pilot",
      displayName: "Pilot",
      runtime: "workbuddy",
      key: "workbuddy-pilot",
    });
    expect(agent.key).toBe("workbuddy-pilot");

    await expectCode(
      () =>
        service.registerAgent({
          project: "workbuddy-pilot",
          displayName: "Impostor",
          runtime: "codex",
          key: "workbuddy-pilot",
        }),
      "CONFLICT",
    );

    await service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    await expectCode(
      () =>
        service.registerAgent({
          machineId: "m1",
          project: "p",
          displayName: "A",
          key: "self-serve",
        }),
      "VALIDATION_FAILED",
    );
    await db.close();
  });

  it("外部 runtime 可绑定机器:只登记宿主归属,不静默改成 claude_code", async () => {
    const { db, service } = await prepare();
    await service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    const { agent } = await service.registerAgent({
      machineId: "m1",
      project: "p",
      displayName: "A",
      runtime: "workbuddy",
      key: "wb-p",
    });
    expect(agent.runtime).toBe("workbuddy");
    expect(agent.machineId).toBe("m1");
    expect(agent.key).toBe("wb-p");
    await db.close();
  });

  it("同机同项目不许有两个 Agent", async () => {
    const { db, service } = await prepare();
    await service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    await service.registerAgent({ machineId: "m1", project: "p", displayName: "A" });
    await expectCode(
      () =>
        service.registerAgent({
          machineId: "m1",
          project: "p",
          displayName: "B",
          runtime: "workbuddy",
        }),
      "CONFLICT",
    );
    await db.close();
  });
});

describe("机器改名", () => {
  it("只改展示名,hostname 去重键不动", async () => {
    const { db, service } = await prepare();
    await service.registerMachine({ id: "m1", hostname: "192.168.1.244", os: "linux", collectorVersion: "1" });

    const renamed = await service.renameMachine("m1", "  工作室机  ");
    expect(renamed.displayName).toBe("工作室机");
    expect(renamed.hostname).toBe("192.168.1.244");
    await db.close();
  });

  it("空名与未注册机器都报错", async () => {
    const { db, service } = await prepare();
    await service.registerMachine({ id: "m1", hostname: "h", os: "linux", collectorVersion: "1" });
    await expectCode(() => service.renameMachine("m1", "  "), "VALIDATION_FAILED");
    await expectCode(() => service.renameMachine("m_ghost", "x"), "NOT_FOUND");
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
