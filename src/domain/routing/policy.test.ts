import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertAssembly } from "../../store/repositories/assembly.js";
import { confirmAgents } from "../bootstrap/config-delivery.js";
import { createIdentityService } from "../identity/service.js";
import {
  buildWorkPolicy,
  computePolicyVersion,
  DEFAULT_BUG_FIX,
  PolicyError,
  validatePolicy,
  WORK_KINDS,
  type RouteRule,
  type WorkPolicy,
} from "./policy.js";

describe("computePolicyVersion", () => {
  it("同内容同版本,键序无关,内容变化则变化", () => {
    const a = { workKinds: WORK_KINDS, rules: [], registry: {} };
    const reordered = { registry: {}, rules: [], workKinds: WORK_KINDS };
    expect(computePolicyVersion(a)).toBe(computePolicyVersion(reordered));
    expect(computePolicyVersion(a)).toBe(computePolicyVersion(a));
    expect(computePolicyVersion(a)).toMatch(/^[0-9a-f]{12}$/);

    const changed = {
      workKinds: WORK_KINDS,
      rules: [
        {
          ruleId: "r1",
          source: "bug",
          kind: "submitted",
          workKind: "bug_fix",
          targetRole: "primary",
        },
      ],
      registry: {},
    };
    expect(computePolicyVersion(changed)).not.toBe(computePolicyVersion(a));
  });
});

describe("策略单源", () => {
  it("WORK_KINDS.bug_fix 与 DEFAULT_BUG_FIX 同源,ROUTE_RULES 首条与其对应", () => {
    expect(WORK_KINDS["bug_fix"]?.mandate).toEqual(DEFAULT_BUG_FIX.mandate);
    expect(WORK_KINDS["bug_fix"]?.evidence).toEqual(DEFAULT_BUG_FIX.evidence);
    const policy = buildWorkPolicy();
    const rule = policy.rules[0];
    expect(rule).toBeDefined();
    if (rule === undefined) {
      return;
    }
    expect(rule.ruleId).toBe(DEFAULT_BUG_FIX.routeRule.ruleId);
    expect(rule.source).toBe(DEFAULT_BUG_FIX.routeRule.source);
    expect(rule.kind).toBe(DEFAULT_BUG_FIX.routeRule.kind);
    expect(rule.targetRole).toBe(DEFAULT_BUG_FIX.routeRule.targetRole);
    expect(rule.workKind).toBe(DEFAULT_BUG_FIX.workKind);
  });
});

function rule(overrides: Partial<RouteRule>): RouteRule {
  return {
    ruleId: "r1",
    source: "bug",
    kind: "submitted",
    workKind: "bug_fix",
    targetRole: "primary",
    ...overrides,
  };
}

function policyWith(rules: readonly RouteRule[], registry: WorkPolicy["registry"] = {}): WorkPolicy {
  return { version: "", workKinds: WORK_KINDS, rules, registry };
}

describe("validatePolicy 结构校验(fail-fast)", () => {
  it("重复 ruleId 抛错", async () => {
    const db = await openDatabase();
    dbs.push(db);
    await expect(
      validatePolicy({ db }, policyWith([rule({}), rule({ ruleId: "r1" })])),
    ).rejects.toThrow(PolicyError);
  });

  it("未知 workKind 或空字段抛错", async () => {
    const db = await openDatabase();
    dbs.push(db);
    await expect(
      validatePolicy({ db }, policyWith([rule({ workKind: "ghost" })])),
    ).rejects.toThrow(PolicyError);
    await expect(
      validatePolicy({ db }, policyWith([rule({ targetRole: "" })])),
    ).rejects.toThrow(PolicyError);
  });

  it("注册表空 key 抛错;规则限定未登记项目只告警", async () => {
    const db = await openDatabase();
    dbs.push(db);
    await expect(
      validatePolicy({ db }, policyWith([rule({})], { proj: { primary: "" } })),
    ).rejects.toThrow(PolicyError);

    const result = await validatePolicy(
      { db },
      policyWith([rule({ project: "proj" })], {}),
    );
    expect(result.warnings).toHaveLength(1);
  });
});

const dbs: Db[] = [];

afterEach(async () => {
  for (const db of dbs.splice(0)) {
    await db.close();
  }
});

/** 走真实域链路登记一台机器并确认一个项目,得到带 key 的 Agent */
async function seededAgent(project: string): Promise<{ db: Db; agentKey: string; agentId: string }> {
  const db = await openDatabase();
  const service = createIdentityService({ db });
  await service.registerMachine({
    id: `m-policy-${project}`,
    hostname: "mac-policy",
    os: "darwin",
    collectorVersion: "0.1.0",
  });
  const now = Date.now();
  const [created] = await confirmAgents(
    { db, now: () => now },
    {
      machineId: `m-policy-${project}`,
      entries: [{ project, displayName: project }],
    },
  );
  if (created === undefined) {
    throw new Error("测试造数失败:未创建 Agent");
  }
  return { db, agentKey: created.key, agentId: created.id };
}

describe("validatePolicy 引用校验(告警不阻断)", () => {
  it("未注册 key 与停用 agent 只产生告警", async () => {
    const { db, agentKey, agentId } = await seededAgent("pilot");
    dbs.push(db);

    const missing = await validatePolicy(
      { db },
      policyWith([rule({})], { proj: { primary: "ghost-agent" } }),
    );
    expect(missing.warnings.join("\n")).toContain("ghost-agent");

    await db.run("UPDATE agent SET status = 'disabled' WHERE id = $1", agentId);
    const inactive = await validatePolicy(
      { db },
      policyWith([rule({})], { proj: { primary: agentKey } }),
    );
    expect(inactive.warnings.join("\n")).toContain("已停用");
  });

  it("primary 与 bootstrap 主责不一致告警,一致则无告警;他项目主责不算漂移", async () => {
    const { db, agentKey, agentId } = await seededAgent("aligned");
    dbs.push(db);
    await insertAssembly(db, {
      primaryAgentId: agentId,
      workKind: "bug_fix",
      assembledAt: Date.now(),
    });

    const mismatch = await validatePolicy(
      { db },
      policyWith([rule({})], { aligned: { primary: "another-agent" } }),
    );
    expect(mismatch.warnings.join("\n")).toContain("不一致");

    const aligned = await validatePolicy(
      { db },
      policyWith([rule({})], { aligned: { primary: agentKey } }),
    );
    expect(aligned.warnings).toHaveLength(0);

    // 非装配项目的 primary 是另一 Agent,不算与 bootstrap 漂移
    const otherProject = await validatePolicy(
      { db },
      policyWith([rule({})], { pilot: { primary: agentKey } }),
    );
    expect(otherProject.warnings).toHaveLength(0);
  });

  it("默认策略校验返回版本;试点 key 未注册只告警,注册后告警消失", async () => {
    const bare = await openDatabase();
    dbs.push(bare);
    const warned = await validatePolicy({ db: bare });
    expect(warned.warnings.join("\n")).toContain("workbuddy-pilot");
    expect(warned.warnings.join("\n")).toContain("尚未注册");
    expect(warned.version).toMatch(/^[0-9a-f]{12}$/);

    // confirmAgents 按项目名派生 key,恰好对上试点条目
    const { db } = await seededAgent("workbuddy-pilot");
    dbs.push(db);
    const seeded = await validatePolicy({ db });
    expect(seeded.warnings).toHaveLength(0);
  });
});
