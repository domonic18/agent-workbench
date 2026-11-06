import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import {
  findMachineById,
  insertMachine,
  touchMachineLastSeen,
  type NewMachine,
} from "../../store/repositories/machine.js";
import { enrollMachine } from "./enroll.js";

async function prepare(): Promise<Db> {
  return openDatabase();
}

function machine(overrides: Partial<NewMachine> = {}): NewMachine {
  return {
    id: "m-1",
    hostname: "build-box",
    os: "darwin",
    collectorVersion: "0.1.0",
    collectorSecretHash: "hash-1",
    createdAt: 1_000,
    ...overrides,
  };
}

const NOW = 1_000_000;

describe("执行机 enroll", () => {
  it("同主机名同系统且无存活上报时复用存量机器行并轮换密钥", async () => {
    const db = await prepare();
    await insertMachine(db, machine());

    const result = await enrollMachine(
      { db, now: () => NOW },
      { hostname: "build-box", os: "darwin", collectorVersion: "0.2.0" },
    );

    expect(result.reused).toBe(true);
    expect(result.machineId).toBe("m-1");
    const row = await findMachineById(db, "m-1");
    expect(row?.collectorSecretHash).not.toBe("hash-1");
    expect(row?.collectorVersion).toBe("0.2.0");
    await db.close();
  });

  it("存量机器心跳正常时不复用,另起新行", async () => {
    const db = await prepare();
    await insertMachine(db, machine());
    await touchMachineLastSeen(db, "m-1", NOW - 60_000);

    const result = await enrollMachine(
      { db, now: () => NOW },
      { hostname: "build-box", os: "darwin", collectorVersion: "0.2.0" },
    );

    expect(result.reused).toBe(false);
    expect(result.machineId).not.toBe("m-1");
    await db.close();
  });

  it("系统不同的同名机器不复用", async () => {
    const db = await prepare();
    await insertMachine(db, machine());

    const result = await enrollMachine(
      { db, now: () => NOW },
      { hostname: "build-box", os: "linux", collectorVersion: "0.2.0" },
    );

    expect(result.reused).toBe(false);
    expect(result.machineId).not.toBe("m-1");
    await db.close();
  });

  it("没有存量行时新建机器", async () => {
    const db = await prepare();

    const result = await enrollMachine(
      { db, now: () => NOW },
      { hostname: "fresh-box", os: "darwin", collectorVersion: "0.2.0" },
    );

    expect(result.reused).toBe(false);
    expect(result.machineId).toMatch(/^m-[0-9a-f]{12}$/);
    expect(result.secret.length).toBeGreaterThan(0);
    await db.close();
  });
});
