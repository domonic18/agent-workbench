import { describe, expect, it } from "vitest";
import {
  confirmAgents,
  ackMachineConfig,
  pullMachineConfig,
} from "../../domain/bootstrap/config-delivery.js";
import { createIdentityService } from "../../domain/identity/service.js";
import { touchMachineLastSeen } from "../../store/repositories/machine.js";
import { openDatabase, type Db } from "../../store/database.js";
import { buildApp } from "../app.js";
import { ensureConsoleCredential } from "../credential.js";

const PASSWORD = "simple-123";
const MACHINE_ID = "m-bootstrap-complete-1";
const WRITE_HEADERS = { "x-requested-with": "fetch", "idempotency-key": "complete-key" };

interface Fixture {
  db: Db;
  app: ReturnType<typeof buildApp>;
  cookie: string;
  agentId: string;
}

/** 已初始化控制台 + 机器心跳在线 + 一个已确认并回执生效的 Agent */
async function completeApp(effective: boolean): Promise<Fixture> {
  const db = await openDatabase();
  await ensureConsoleCredential(db, PASSWORD);
  const service = createIdentityService({ db });
  await service.registerMachine({
    id: MACHINE_ID,
    hostname: "mac-complete",
    os: "darwin",
    collectorVersion: "0.1.0",
  });
  const now = Date.now();
  await touchMachineLastSeen(db, MACHINE_ID, now);
  const [created] = await confirmAgents(
    { db, now: () => now },
    { machineId: MACHINE_ID, entries: [{ project: "proj" }] },
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
      {
        machineId: MACHINE_ID,
        acks: [{ agentId: agent.agent_id, configVersion: agent.config_version }],
      },
    );
  }
  const app = buildApp({ db, logLevel: "silent" });
  await app.ready();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { password: PASSWORD },
  });
  expect(login.statusCode).toBe(200);
  const raw = login.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return {
    db,
    app,
    cookie: (typeof first === "string" ? first : "").split(";")[0] ?? "",
    agentId,
  };
}

async function close(fixture: Fixture): Promise<void> {
  await fixture.db.close();
  await fixture.app.close();
}

describe("GET /api/bootstrap/status 第 4 步阶段", () => {
  it("Agent 确认后装配前是 awaiting_completion,带默认 bug_fix 摘要;装配后 ready", async () => {
    const fixture = await completeApp(true);
    try {
      const before = await fixture.app.inject({
        method: "GET",
        url: "/api/bootstrap/status",
        headers: { cookie: fixture.cookie },
      });
      expect(before.statusCode).toBe(200);
      expect(before.json()).toMatchObject({
        phase: "awaiting_completion",
        assembly: null,
        definition: { workKind: "bug_fix" },
      });

      const completed = await fixture.app.inject({
        method: "POST",
        url: "/api/bootstrap/complete",
        headers: { cookie: fixture.cookie, ...WRITE_HEADERS },
        payload: { primaryAgentId: fixture.agentId },
      });
      expect(completed.statusCode).toBe(201);

      const after = await fixture.app.inject({
        method: "GET",
        url: "/api/bootstrap/status",
        headers: { cookie: fixture.cookie },
      });
      expect(after.json()).toMatchObject({
        phase: "ready",
        assembly: { primaryAgentId: fixture.agentId, workKind: "bug_fix" },
      });
    } finally {
      await close(fixture);
    }
  });
});

describe("POST /api/bootstrap/preflight", () => {
  it("需要会话;通过后分项返回并可就绪", async () => {
    const fixture = await completeApp(true);
    try {
      const anonymous = await fixture.app.inject({ method: "POST", url: "/api/bootstrap/preflight" });
      expect(anonymous.statusCode).toBe(401);

      const result = await fixture.app.inject({
        method: "POST",
        url: "/api/bootstrap/preflight",
        headers: { cookie: fixture.cookie },
      });
      expect(result.statusCode).toBe(200);
      const body = result.json();
      expect(body.items.map((item: { key: string }) => item.key)).toEqual([
        "database",
        "machine",
        "collection",
        "agent",
        "mcp",
        "roles",
        "bug_source",
        "github_ci",
      ]);
      expect(body.ready).toBe(false);
    } finally {
      await close(fixture);
    }
  });
});

describe("POST /api/bootstrap/complete", () => {
  it("缺 CSRF 拒绝;预检未通过 422 且不落装配;重放幂等", async () => {
    const fixture = await completeApp(false);
    try {
      const noCsrf = await fixture.app.inject({
        method: "POST",
        url: "/api/bootstrap/complete",
        headers: { cookie: fixture.cookie, "idempotency-key": "k" },
        payload: { primaryAgentId: fixture.agentId },
      });
      expect(noCsrf.statusCode).toBe(403);

      const blocked = await fixture.app.inject({
        method: "POST",
        url: "/api/bootstrap/complete",
        headers: { cookie: fixture.cookie, ...WRITE_HEADERS },
        payload: { primaryAgentId: fixture.agentId },
      });
      expect(blocked.statusCode).toBe(422);
      expect(blocked.json().error.detail.failed).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: "collection" })]),
      );

      const status = await fixture.app.inject({
        method: "GET",
        url: "/api/bootstrap/status",
        headers: { cookie: fixture.cookie },
      });
      expect(status.json()).toMatchObject({ phase: "awaiting_completion", assembly: null });
    } finally {
      await close(fixture);
    }
  });
});
