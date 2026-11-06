import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirmAgents } from "./config-delivery.js";
import {
  ackMachineConfig,
  pullMachineConfig,
} from "./config-delivery.js";
import { BootstrapError } from "./errors.js";
import {
  completeBootstrap,
  DEFAULT_BUG_FIX,
  HEARTBEAT_FRESH_MS,
  runPreflight,
} from "./assembly.js";
import { createIdentityService } from "../identity/service.js";
import { touchMachineLastSeen } from "../../store/repositories/machine.js";
import { findAssembly } from "../../store/repositories/assembly.js";
import { openDatabase, type Db } from "../../store/database.js";

const MACHINE_ID = "m-assembly-1";

interface Seed {
  db: Db;
  agentId: string;
  now: number;
}

/** 走真实域链路造数:登记机器 → 心跳 → 项目确认 → 下发 → ACK,全 effective */
async function seededState(effective: boolean): Promise<Seed> {
  const db = await openDatabase();
  const service = createIdentityService({ db });
  await service.registerMachine({
    id: MACHINE_ID,
    hostname: "mac-assembly",
    os: "darwin",
    collectorVersion: "0.1.0",
  });
  const now = Date.now();
  await touchMachineLastSeen(db, MACHINE_ID, now);
  const [created] = await confirmAgents(
    { db, now: () => now },
    { machineId: MACHINE_ID, entries: [{ project: "proj", displayName: "Proj Agent" }] },
  );
  let agentId = created?.id ?? "";
  if (effective) {
    const pulled = await pullMachineConfig({ db, now: () => now }, { machineId: MACHINE_ID });
    const agent = pulled.agents.find((entry) => entry.project === "proj");
    if (agent === undefined) {
      throw new Error("配置下发未返回确认的 Agent");
    }
    agentId = agent.agent_id;
    await ackMachineConfig(
      { db, now: () => now },
      { machineId: MACHINE_ID, acks: [{ agentId: agent.agent_id, configVersion: agent.config_version }] },
    );
  }
  return { db, agentId, now };
}

describe("runPreflight", () => {
  let db: Db;
  beforeEach(async () => {
    db = await openDatabase();
  });
  afterEach(async () => {
    await db.close();
  });

  it("空库:六项可校验全失败,集成项未配置,不就绪", async () => {
    const result = await runPreflight({ db, now: () => 1_000 });
    const statusOf = (k: string): string => result.items.find((i) => i.key === k)!.status;
    expect(result.ready).toBe(false);
    expect(statusOf("database")).toBe("ok");
    expect(statusOf("machine")).toBe("fail");
    expect(statusOf("collection")).toBe("fail");
    expect(statusOf("agent")).toBe("fail");
    expect(statusOf("mcp")).toBe("fail");
    expect(statusOf("roles")).toBe("fail");
    expect(statusOf("bug_source")).toBe("not_configured");
    expect(statusOf("github_ci")).toBe("not_configured");
  });

  it("心跳超时的机器按机器项失败处理", async () => {
    const service = createIdentityService({ db });
    await service.registerMachine({
      id: MACHINE_ID,
      hostname: "mac-stale",
      os: "darwin",
      collectorVersion: "0.1.0",
    });
    const now = 10_000_000;
    await touchMachineLastSeen(db, MACHINE_ID, now - HEARTBEAT_FRESH_MS - 1);
    const result = await runPreflight({ db, now: () => now });
    const machine = result.items.find((item) => item.key === "machine");
    expect(machine?.status).toBe("fail");
    expect(machine?.hint).toContain("aw-node");
  });
});

describe("completeBootstrap", () => {
  let seed: Seed;
  beforeEach(async () => {
    seed = await seededState(true);
  });
  afterEach(async () => {
    await seed.db.close();
  });

  it("全链路就绪后装配:落主责绑定,预检转就绪", async () => {
    const before = await runPreflight({ db: seed.db, now: () => seed.now });
    expect(before.ready).toBe(false);
    expect(before.items.find((item) => item.key === "roles")?.status).toBe("fail");

    const result = await completeBootstrap(
      { db: seed.db, now: () => seed.now },
      { primaryAgentId: seed.agentId },
    );
    expect(result.assembly).toEqual({
      primaryAgentId: seed.agentId,
      workKind: "bug_fix",
      assembledAt: seed.now,
    });
    expect(result.definition).toEqual(DEFAULT_BUG_FIX);
    expect(result.preflight.ready).toBe(true);
    expect(result.preflight.items.find((item) => item.key === "roles")?.status).toBe("ok");
  });

  it("重复调用幂等:返回既有装配,不重复落库", async () => {
    const first = await completeBootstrap(
      { db: seed.db, now: () => seed.now },
      { primaryAgentId: seed.agentId },
    );
    const second = await completeBootstrap(
      { db: seed.db, now: () => seed.now + 5_000 },
      { primaryAgentId: seed.agentId },
    );
    expect(second.assembly).toEqual(first.assembly);
    const rows = (await seed.db.all("SELECT * FROM bootstrap_assembly")) as unknown[];
    expect(rows).toHaveLength(1);
  });

  it("预检未通过(配置未回执)不创建装配", async () => {
    const pending = await seededState(false);
    try {
      await expect(
        completeBootstrap({ db: pending.db, now: () => pending.now }, { primaryAgentId: pending.agentId }),
      ).rejects.toThrow(BootstrapError);
      await expect(
        completeBootstrap({ db: pending.db, now: () => pending.now }, { primaryAgentId: pending.agentId }),
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        detail: {
          failed: expect.arrayContaining([expect.objectContaining({ key: "collection" })]),
        },
      });
      expect(await findAssembly(pending.db)).toBeUndefined();
    } finally {
      await pending.db.close();
    }
  });

  it("主责 Agent 不存在拒绝", async () => {
    await expect(
      completeBootstrap({ db: seed.db, now: () => seed.now }, { primaryAgentId: "agt-none" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
