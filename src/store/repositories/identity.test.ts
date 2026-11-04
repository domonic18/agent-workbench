import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import {
  findAgentById,
  findAgentByMachineProject,
  findMachineById,
  insertAgent,
  insertMachine,
  listAgents,
  listMachines,
  updateAgentSecretHash,
  updateMachineSecretHash,
  type NewAgent,
  type NewMachine,
} from "./identity.js";

async function prepare(): Promise<Db> {
  return openDatabase();
}

function machine(overrides: Partial<NewMachine> = {}): NewMachine {
  return {
    id: "macmini-01",
    hostname: "macmini.local",
    os: "darwin",
    collectorVersion: "0.1.0",
    collectorSecretHash: "hash-1",
    createdAt: 1_000,
    ...overrides,
  };
}

function agent(overrides: Partial<NewAgent> = {}): NewAgent {
  return {
    id: "agt_a",
    machineId: "macmini-01",
    runtime: "claude_code",
    project: "aw",
    displayName: "Agent A",
    secretHash: "hash-a",
    feishuAppId: null,
    allowedTargetsJson: '["agt_b"]',
    createdAt: 1_000,
    ...overrides,
  };
}

describe("machine 仓储", () => {
  it("插入后按 id 读取,默认 active", async () => {
    const db = await prepare();
    await insertMachine(db, machine());

    expect(await findMachineById(db, "macmini-01")).toMatchObject({
      id: "macmini-01",
      collectorSecretHash: "hash-1",
      status: "active",
      lastSeenAt: null,
    });
    expect(await findMachineById(db, "missing")).toBeUndefined();
    await db.close();
  });

  it("轮换哈希后读回新值", async () => {
    const db = await prepare();
    await insertMachine(db, machine());

    expect(await updateMachineSecretHash(db, "macmini-01", "hash-2")).toBe(true);
    expect((await findMachineById(db, "macmini-01"))?.collectorSecretHash).toBe("hash-2");
    expect(await updateMachineSecretHash(db, "missing", "hash-2")).toBe(false);
    await db.close();
  });

  it("列表按创建时间倒序键集分页", async () => {
    const db = await prepare();
    await insertMachine(db, machine({ id: "m1", createdAt: 1_000 }));
    await insertMachine(db, machine({ id: "m2", createdAt: 2_000 }));
    await insertMachine(db, machine({ id: "m3", createdAt: 3_000 }));

    const first = await listMachines(db, { limit: 2 });
    expect(first.map((row) => row.id)).toEqual(["m3", "m2"]);
    const second = await listMachines(db, {
      limit: 2,
      before: { createdAt: first[1]!.createdAt, id: first[1]!.id },
    });
    expect(second.map((row) => row.id)).toEqual(["m1"]);
    await db.close();
  });
});

describe("agent 仓储", () => {
  it("按 id 与 (machine, project) 查询", async () => {
    const db = await prepare();
    await insertMachine(db, machine());
    await insertAgent(db, agent());

    expect(await findAgentById(db, "agt_a")).toMatchObject({
      id: "agt_a",
      machineId: "macmini-01",
      project: "aw",
      status: "active",
      allowedTargetsJson: '["agt_b"]',
    });
    expect((await findAgentByMachineProject(db, "macmini-01", "aw"))?.id).toBe("agt_a");
    expect(await findAgentByMachineProject(db, "macmini-01", "other")).toBeUndefined();
    await db.close();
  });

  it("(machine_id, project) 唯一", async () => {
    const db = await prepare();
    await insertMachine(db, machine());
    await insertAgent(db, agent());

    await expect(insertAgent(db, agent({ id: "agt_dup" }))).rejects.toThrow(/unique/i);
    await db.close();
  });

  it("轮换哈希并更新 updated_at", async () => {
    const db = await prepare();
    await insertMachine(db, machine());
    await insertAgent(db, agent());

    expect(await updateAgentSecretHash(db, "agt_a", "hash-b", 9_000)).toBe(true);
    expect(await findAgentById(db, "agt_a")).toMatchObject({
      secretHash: "hash-b",
      updatedAt: 9_000,
    });
    await db.close();
  });

  it("列表按创建时间倒序键集分页", async () => {
    const db = await prepare();
    await insertMachine(db, machine());
    await insertAgent(db, agent({ id: "agt_1", project: "p1", createdAt: 1_000 }));
    await insertAgent(db, agent({ id: "agt_2", project: "p2", createdAt: 2_000 }));

    const first = await listAgents(db, { limit: 1 });
    expect(first.map((row) => row.id)).toEqual(["agt_2"]);
    const second = await listAgents(db, {
      limit: 1,
      before: { createdAt: first[0]!.createdAt, id: first[0]!.id },
    });
    expect(second.map((row) => row.id)).toEqual(["agt_1"]);
    await db.close();
  });
});
