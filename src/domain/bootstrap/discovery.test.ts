import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertMachine, touchMachineLastSeen } from "../../store/repositories/machine.js";
import {
  isVersionBehind,
  listDiscoveryForConsole,
  saveDiscoveryReport,
} from "./discovery.js";

async function prepare(): Promise<Db> {
  return openDatabase();
}

describe("执行机发现视图", () => {
  it("心跳与发现上报分别取各自的时间源", async () => {
    const db = await prepare();
    await insertMachine(db, {
      id: "mch_1",
      hostname: "build-box",
      os: "darwin",
      collectorVersion: "0.1.0",
      collectorSecretHash: "hash-1",
      createdAt: 1_000,
    });
    await touchMachineLastSeen(db, "mch_1", 5_000);
    await saveDiscoveryReport(db, {
      machineId: "mch_1",
      report: { projects: [{ name: "aw" }] },
      now: () => 9_000,
    });

    const views = await listDiscoveryForConsole(db);
    const view = views.find((item) => item.machineId === "mch_1");

    expect(view?.lastSeenAt).toBe(5_000);
    expect(view?.receivedAt).toBe(9_000);
    await db.close();
  });

  it("未上报过的机器两路时间都为 null", async () => {
    const db = await prepare();
    await insertMachine(db, {
      id: "mch_2",
      hostname: "silent-box",
      os: "darwin",
      collectorVersion: "0.1.0",
      collectorSecretHash: "hash-2",
      createdAt: 2_000,
    });

    const views = await listDiscoveryForConsole(db);
    const view = views.find((item) => item.machineId === "mch_2");

    expect(view?.lastSeenAt).toBeNull();
    expect(view?.receivedAt).toBeNull();
    await db.close();
  });

  it("携带最新产物版本时逐机器标可升级,不携带不标", async () => {
    const db = await prepare();
    for (const [id, version] of [
      ["mch_old", "0.2.2"],
      ["mch_new", "0.3.1"],
    ] as const) {
      await insertMachine(db, {
        id,
        hostname: id,
        os: "darwin",
        collectorVersion: version,
        collectorSecretHash: "hash",
        createdAt: 1_000,
      });
    }

    const plain = await listDiscoveryForConsole(db);
    expect(plain.every((view) => view.upgradeAvailable)).toBe(false);
    expect(plain.map((view) => view.collectorVersion).sort()).toEqual(["0.2.2", "0.3.1"]);

    const withLatest = await listDiscoveryForConsole(db, "0.3.1");
    expect(withLatest.find((view) => view.machineId === "mch_old")?.upgradeAvailable).toBe(true);
    expect(withLatest.find((view) => view.machineId === "mch_new")?.upgradeAvailable).toBe(false);
    await db.close();
  });

  it("版本比较:点分数字按段比,位数补零,非数字段不可比不误报", () => {
    expect(isVersionBehind("0.2.9", "0.3.0")).toBe(true);
    expect(isVersionBehind("0.3.0", "0.3.0")).toBe(false);
    expect(isVersionBehind("0.10.0", "0.9.9")).toBe(false);
    expect(isVersionBehind("0.3", "0.3.0")).toBe(false);
    expect(isVersionBehind("dev", "0.3.0")).toBe(false);
    expect(isVersionBehind("0.2.2", "dev-build")).toBe(false);
  });
});
