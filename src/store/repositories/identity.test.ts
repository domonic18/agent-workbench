import { describe, expect, it } from "vitest";
import { openDatabase } from "../database.js";
import { runMigrations } from "../migrator.js";
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

function prepare() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
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
  it("插入后按 id 读取,默认 active", () => {
    const db = prepare();
    insertMachine(db, machine());

    expect(findMachineById(db, "macmini-01")).toMatchObject({
      id: "macmini-01",
      collectorSecretHash: "hash-1",
      status: "active",
      lastSeenAt: null,
    });
    expect(findMachineById(db, "missing")).toBeUndefined();
    db.close();
  });

  it("轮换哈希后读回新值", () => {
    const db = prepare();
    insertMachine(db, machine());

    expect(updateMachineSecretHash(db, "macmini-01", "hash-2")).toBe(true);
    expect(findMachineById(db, "macmini-01")?.collectorSecretHash).toBe("hash-2");
    expect(updateMachineSecretHash(db, "missing", "hash-2")).toBe(false);
    db.close();
  });

  it("列表按创建时间倒序键集分页", () => {
    const db = prepare();
    insertMachine(db, machine({ id: "m1", createdAt: 1_000 }));
    insertMachine(db, machine({ id: "m2", createdAt: 2_000 }));
    insertMachine(db, machine({ id: "m3", createdAt: 3_000 }));

    const first = listMachines(db, { limit: 2 });
    expect(first.map((row) => row.id)).toEqual(["m3", "m2"]);
    const second = listMachines(db, {
      limit: 2,
      before: { createdAt: first[1]!.createdAt, id: first[1]!.id },
    });
    expect(second.map((row) => row.id)).toEqual(["m1"]);
    db.close();
  });
});

describe("agent 仓储", () => {
  it("按 id 与 (machine, project) 查询", () => {
    const db = prepare();
    insertMachine(db, machine());
    insertAgent(db, agent());

    expect(findAgentById(db, "agt_a")).toMatchObject({
      id: "agt_a",
      machineId: "macmini-01",
      project: "aw",
      status: "active",
      allowedTargetsJson: '["agt_b"]',
    });
    expect(findAgentByMachineProject(db, "macmini-01", "aw")?.id).toBe("agt_a");
    expect(findAgentByMachineProject(db, "macmini-01", "other")).toBeUndefined();
    db.close();
  });

  it("(machine_id, project) 唯一", () => {
    const db = prepare();
    insertMachine(db, machine());
    insertAgent(db, agent());

    expect(() => insertAgent(db, agent({ id: "agt_dup" }))).toThrow(/UNIQUE/);
    db.close();
  });

  it("轮换哈希并更新 updated_at", () => {
    const db = prepare();
    insertMachine(db, machine());
    insertAgent(db, agent());

    expect(updateAgentSecretHash(db, "agt_a", "hash-b", 9_000)).toBe(true);
    expect(findAgentById(db, "agt_a")).toMatchObject({
      secretHash: "hash-b",
      updatedAt: 9_000,
    });
    db.close();
  });

  it("列表按创建时间倒序键集分页", () => {
    const db = prepare();
    insertMachine(db, machine());
    insertAgent(db, agent({ id: "agt_1", project: "p1", createdAt: 1_000 }));
    insertAgent(db, agent({ id: "agt_2", project: "p2", createdAt: 2_000 }));

    const first = listAgents(db, { limit: 1 });
    expect(first.map((row) => row.id)).toEqual(["agt_2"]);
    const second = listAgents(db, {
      limit: 1,
      before: { createdAt: first[0]!.createdAt, id: first[0]!.id },
    });
    expect(second.map((row) => row.id)).toEqual(["agt_1"]);
    db.close();
  });
});
