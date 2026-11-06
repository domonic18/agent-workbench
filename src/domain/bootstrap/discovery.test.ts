import { describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertMachine, touchMachineLastSeen } from "../../store/repositories/machine.js";
import { listDiscoveryForConsole, saveDiscoveryReport } from "./discovery.js";

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
});
