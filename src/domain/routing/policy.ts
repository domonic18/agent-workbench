import { createHash } from "node:crypto";
import type { Db } from "../../store/database.js";
import { findAssembly } from "../../store/repositories/assembly.js";
import { findAgentById, findAgentByKey } from "../../store/repositories/identity.js";

/**
 * Git 版本化工作策略(arch/01 §9.2、arch/02 §3.9):work_kind 与 RouteRule 的
 * 定义本体随仓库源码版本化,修改走源码评审,不提供在线规则编辑器。
 * policy_version 是策略内容的确定性摘要,不依赖 git(容器内无 .git)。
 */

export interface WorkKindDefinition {
  readonly mandate: { readonly expectedResult: string; readonly scope: string };
  readonly evidence: readonly string[];
}

export interface RouteRule {
  readonly ruleId: string;
  readonly source: string;
  readonly kind: string;
  /** 只在该业务项目命中;缺省为跨项目规则 */
  readonly project?: string;
  readonly workKind: string;
  readonly targetRole: string;
}

/** 业务项目注册表:project → role → agent.key(arch/02 §3.1,不改 agent 表) */
export type ProjectRegistry = Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface WorkPolicy {
  readonly version: string;
  readonly workKinds: Readonly<Record<string, WorkKindDefinition>>;
  readonly rules: readonly RouteRule[];
  readonly registry: ProjectRegistry;
}

const BUG_FIX_MANDATE = {
  expectedResult:
    "修复缺陷并提交 PR;PR head SHA 的必需 CI 全部通过后进入待验收,由原 Bug 机器人人工接受",
  scope:
    "以原始 Bug 反馈为范围修复缺陷本身,不含顺手重构;退回时在同一工作事项返工,生产发布另行人工确认",
} as const;

const BUG_FIX_EVIDENCE = [
  "PR 链接与当前 head SHA",
  "必需 CI 全部通过的记录",
  "原 Bug 机器人的接受回执",
] as const;

/** 默认 bug_fix 装配定义(arch/01 §9.4):bootstrap 装配与 /setup 摘要复用同一来源 */
export const DEFAULT_BUG_FIX = {
  workKind: "bug_fix",
  routeRule: {
    ruleId: "default-bug-fix",
    source: "bug",
    kind: "submitted",
    targetRole: "primary",
  },
  mandate: BUG_FIX_MANDATE,
  evidence: BUG_FIX_EVIDENCE,
} as const;

export const WORK_KINDS: Readonly<Record<string, WorkKindDefinition>> = {
  bug_fix: { mandate: BUG_FIX_MANDATE, evidence: BUG_FIX_EVIDENCE },
};

export const ROUTE_RULES: readonly RouteRule[] = [
  {
    ruleId: DEFAULT_BUG_FIX.routeRule.ruleId,
    source: DEFAULT_BUG_FIX.routeRule.source,
    kind: DEFAULT_BUG_FIX.routeRule.kind,
    workKind: DEFAULT_BUG_FIX.workKind,
    targetRole: DEFAULT_BUG_FIX.routeRule.targetRole,
  },
];

/**
 * 项目注册表:未登记项目的未归属事件确定性 needs_person,不猜目标。
 * workbuddy-pilot 是 M3.9-1 联测的试点项目——目标 Agent 注册时自带
 * key="workbuddy-pilot"(机器无关 Agent 的稳定键由注册方显式给出);
 * 未部署该 Agent 的环境启动时只产生引用告警,不影响其余项目派工。
 */
export const PROJECT_REGISTRY: ProjectRegistry = {
  "workbuddy-pilot": { primary: "workbuddy-pilot" },
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function computePolicyVersion(
  policy: Pick<WorkPolicy, "workKinds" | "rules" | "registry">,
): string {
  const digest = createHash("sha256").update(stableStringify(policy), "utf8").digest("hex");
  return digest.slice(0, 12);
}

export function buildWorkPolicy(): WorkPolicy {
  const content = { workKinds: WORK_KINDS, rules: ROUTE_RULES, registry: PROJECT_REGISTRY };
  return { ...content, version: computePolicyVersion(content) };
}

export class PolicyError extends Error {}

export interface PolicyValidation {
  readonly version: string;
  readonly warnings: readonly string[];
}

export interface PolicyLogger {
  warn: (message: string) => void;
}

/**
 * 启动校验(arch/01 §9.2「启动时校验并计算 policy_version」):
 * - 结构错误(重复 ruleId、未知 workKind、空字段)fail-fast;
 * - 引用未注册/停用的 agent.key 只告警不阻断——空库重建后 bootstrap 流程必须能启动,
 *   派工时还会再校验 Agent 已注册且启用(arch/02 §3.1)。
 */
export async function validatePolicy(
  deps: { db: Db; log?: PolicyLogger },
  policy: Pick<WorkPolicy, "workKinds" | "rules" | "registry"> = buildWorkPolicy(),
): Promise<PolicyValidation> {
  const warnings: string[] = [];

  const seenRuleIds = new Set<string>();
  for (const rule of policy.rules) {
    if (
      rule.ruleId === "" ||
      rule.source === "" ||
      rule.kind === "" ||
      rule.targetRole === "" ||
      rule.workKind === ""
    ) {
      throw new PolicyError(`RouteRule 字段不能为空: ${rule.ruleId || "(未命名)"}`);
    }
    if (seenRuleIds.has(rule.ruleId)) {
      throw new PolicyError(`RouteRule 重复: ${rule.ruleId}`);
    }
    seenRuleIds.add(rule.ruleId);
    if (policy.workKinds[rule.workKind] === undefined) {
      throw new PolicyError(`RouteRule ${rule.ruleId} 引用未定义的 work_kind ${rule.workKind}`);
    }
    if (rule.project !== undefined && policy.registry[rule.project] === undefined) {
      warnings.push(`规则 ${rule.ruleId} 限定项目 ${rule.project},但项目注册表未登记该项目`);
    }
  }

  for (const [project, roles] of Object.entries(policy.registry)) {
    for (const [role, key] of Object.entries(roles)) {
      if (key === "") {
        throw new PolicyError(`项目注册表 ${project}.${role} 的 agent key 为空`);
      }
      const agent = await findAgentByKey(deps.db, key);
      if (agent === undefined) {
        warnings.push(
          `项目注册表 ${project}.${role} 指向的 agent ${key} 尚未注册,相关事件将 needs_person`,
        );
      } else if (agent.status !== "active") {
        warnings.push(`项目注册表 ${project}.${role} 指向的 agent ${key} 已停用`);
      }
    }
  }

  const assembly = await findAssembly(deps.db);
  if (assembly !== undefined) {
    const primary = await findAgentById(deps.db, assembly.primaryAgentId);
    const assemblyKey = primary?.key ?? assembly.primaryAgentId;
    // 只有 bootstrap 主责所在项目才要求 registry 与装配一致;
    // 其他项目(如试点项目)的主责本就可以是别的 Agent
    const assemblyProject = primary?.project;
    if (assemblyProject !== undefined) {
      const primaryKey = policy.registry[assemblyProject]?.["primary"];
      if (primaryKey !== undefined && primaryKey !== assemblyKey) {
        warnings.push(
          `项目 ${assemblyProject} 的 primary 指向 ${primaryKey},与 bootstrap 主责 ${assemblyKey} 不一致`,
        );
      }
    }
  }

  for (const warning of warnings) {
    deps.log?.warn(warning);
  }
  return { version: computePolicyVersion(policy), warnings };
}
