import { describe, expect, it } from "vitest";
import { RUN_IDLE_GAP_MS } from "../../shared/constants.js";
import { openDatabase, type Db } from "../../store/database.js";
import { findRunById } from "../../store/repositories/run.js";
import { reclaimRunsOnce, startRunReclaimer } from "./run-reclaim.js";

const NOW = 10_000_000;

const logger = {
  info(): void {},
  warn(): void {},
  error(): void {},
};

interface Fixture {
  db: Db;
  run: (now?: number) => Promise<{ swept: string[] }>;
}

async function prepare(): Promise<Fixture> {
  const db = await openDatabase();
  await db.run(
    "INSERT INTO machine (id, hostname, os, collector_version, collector_secret_hash, status, created_at) VALUES ('m1', 'h', 'linux', '1', 'hash', 'active', 0)",
  );
  await db.run(
    `INSERT INTO agent (id, machine_id, project, display_name, secret_hash, status, allowed_targets_json, created_at, updated_at)
     VALUES ('agt_a', 'm1', 'pa', 'agt_a', 'hash', 'active', '[]', 0, 0)`,
  );
  return {
    db,
    run: (now: number = NOW) => reclaimRunsOnce({ db, now: () => now }, logger),
  };
}

async function seedRun(
  db: Db,
  id: string,
  options: {
    status?: "running" | "ended";
    startedAt?: number;
    lastSeenAt: number;
    endedAt?: number | null;
    endReason?: string | null;
  },
): Promise<void> {
  await db.run(
    `INSERT INTO agent_run
       (id, agent_id, machine, project, stream_id, status, started_at, last_seen_at, ended_at, end_reason)
     VALUES (?, 'agt_a', 'm1', 'pa', 'claude-session:s1', ?, ?, ?, ?, ?)`,
    id,
    options.status ?? "running",
    options.startedAt ?? 0,
    options.lastSeenAt,
    options.endedAt ?? null,
    options.endReason ?? null,
  );
}

describe("迟滞 run 兜底收敛", () => {
  it("超时 running 收尾在 last_seen,原因 orphan_swept", async () => {
    const { db, run } = await prepare();
    await seedRun(db, "run_stale", { lastSeenAt: NOW - RUN_IDLE_GAP_MS - 1 });

    const result = await run();

    expect(result.swept).toEqual(["run_stale"]);
    expect(await findRunById(db, "run_stale")).toMatchObject({
      status: "ended",
      endedAt: NOW - RUN_IDLE_GAP_MS - 1,
      endReason: "orphan_swept",
    });
    await db.close();
  });

  it("未超时的 running 不动", async () => {
    const { db, run } = await prepare();
    await seedRun(db, "run_live", { lastSeenAt: NOW - RUN_IDLE_GAP_MS + 1_000 });

    expect((await run()).swept).toEqual([]);
    expect(await findRunById(db, "run_live")).toMatchObject({ status: "running" });
    await db.close();
  });

  it("重复清扫幂等:第二轮无新命中", async () => {
    const { db, run } = await prepare();
    await seedRun(db, "run_stale", { lastSeenAt: NOW - RUN_IDLE_GAP_MS - 1 });

    expect((await run()).swept).toEqual(["run_stale"]);
    expect((await run()).swept).toEqual([]);
    await db.close();
  });

  it("已收尾的历史行不被改写(保留原 end_reason)", async () => {
    const { db, run } = await prepare();
    await seedRun(db, "run_hist", {
      status: "ended",
      lastSeenAt: 1_000,
      endedAt: 1_000,
      endReason: "idle_split",
    });

    expect((await run()).swept).toEqual([]);
    expect(await findRunById(db, "run_hist")).toMatchObject({
      status: "ended",
      endReason: "idle_split",
    });
    await db.close();
  });
});

describe("startRunReclaimer", () => {
  it("随启动扫一轮,停机清定时器", async () => {
    const { db } = await prepare();
    await seedRun(db, "run_stale", { lastSeenAt: NOW - RUN_IDLE_GAP_MS - 1 });

    const reclaimer = startRunReclaimer({ db, now: () => NOW }, logger, 60_000);
    await new Promise((resolve) => setImmediate(resolve));
    reclaimer.stop();

    expect(await findRunById(db, "run_stale")).toMatchObject({
      status: "ended",
      endReason: "orphan_swept",
    });
    await db.close();
  });
});
