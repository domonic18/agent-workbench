import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../database.js";
import {
  findMachineById,
  findReusableMachine,
  insertMachine,
  listMachines,
  updateMachineCollectorVersion,
  updateMachineSecretHash,
  type NewMachine,
} from "./machine.js";

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

  it("复用候选只认同主机名同系统且无存活上报的机器", async () => {
    const db = await prepare();
    await insertMachine(db, machine({ id: "m_stale" }));
    await insertMachine(db, machine({ id: "m_other_host", hostname: "other.local" }));
    await insertMachine(db, machine({ id: "m_other_os", os: "linux" }));

    const stale = await findReusableMachine(db, {
      hostname: "macmini.local",
      os: "darwin",
      staleBefore: 5_000,
    });
    expect(stale?.id).toBe("m_stale");
    expect(
      await findReusableMachine(db, {
        hostname: "missing.local",
        os: "darwin",
        staleBefore: 5_000,
      }),
    ).toBeUndefined();
    await db.close();
  });

  it("刷新采集器版本不改机器 id", async () => {
    const db = await prepare();
    await insertMachine(db, machine());

    expect(await updateMachineCollectorVersion(db, "macmini-01", "0.2.0")).toBe(true);
    expect((await findMachineById(db, "macmini-01"))?.collectorVersion).toBe("0.2.0");
    await db.close();
  });
});
