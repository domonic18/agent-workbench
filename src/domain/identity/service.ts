import { EXTERNAL_RUNTIMES, IDENTITY_LIMITS, type AgentRuntime } from "../../shared/constants.js";
import { newPrefixedId } from "../../shared/ids.js";
import type { Db } from "../../store/database.js";
import {
  findAgentById,
  findAgentByMachineProject,
  findMachineById,
  insertAgent,
  insertMachine,
  listAgents,
  listMachines,
  updateAgentAllowedTargets,
  updateAgentSecretHash,
  updateMachineSecretHash,
  type AgentListQuery,
  type AgentRecord,
  type MachineListQuery,
  type MachineRecord,
} from "../../store/repositories/identity.js";
import { hashSecret, newSecret } from "../security/secrets.js";
import { IdentityError } from "./errors.js";

export interface RegisterMachineInput {
  id: string;
  hostname: string;
  os: string;
  collectorVersion: string;
}

export interface RegisterAgentInput {
  /** 机器绑定 Agent 必填;机器无关 Agent(无 aw-node 的外部运行时)留空,改由 runtime 区分 */
  machineId?: string | null | undefined;
  /** 机器绑定 Agent 强制 claude_code;机器无关 Agent 必须显式给出外部 runtime */
  runtime?: AgentRuntime | undefined;
  project: string;
  displayName: string;
  feishuAppId?: string | null | undefined;
  allowedTargets?: string[] | undefined;
}

export interface RegisteredMachine {
  machine: MachineRecord;
  /** 明文只在本次响应出现;库中仅存哈希 */
  secret: string;
}

export interface RegisteredAgent {
  agent: AgentRecord;
  secret: string;
}

export interface IdentityService {
  registerMachine(input: RegisterMachineInput): Promise<RegisteredMachine>;
  registerAgent(input: RegisterAgentInput): Promise<RegisteredAgent>;
  rotateMachineSecret(id: string): Promise<RegisteredMachine>;
  rotateAgentSecret(id: string): Promise<RegisteredAgent>;
  /** 控制台会话维护委派白名单;Agent 的 Bearer 无权改自己的名单 */
  setAllowedTargets(id: string, targets: string[]): Promise<AgentRecord>;
  listMachines(query: MachineListQuery): Promise<MachineRecord[]>;
  listAgents(query: AgentListQuery): Promise<AgentRecord[]>;
}

export interface IdentityServiceDeps {
  db: Db;
  now?: () => number;
  newAgentId?: () => string;
  newSecret?: () => string;
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new IdentityError("VALIDATION_FAILED", `${field} 必须是字符串`);
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new IdentityError("VALIDATION_FAILED", `${field} 不能为空`);
  }
  if (trimmed.length > max) {
    throw new IdentityError("VALIDATION_FAILED", `${field} 超过 ${max} 字符`);
  }
  return trimmed;
}

function normalizeTargets(input: string[] | undefined): string[] {
  if (input === undefined) {
    return [];
  }
  if (input.length > IDENTITY_LIMITS.allowedTargets) {
    throw new IdentityError(
      "VALIDATION_FAILED",
      `allowedTargets 最多 ${IDENTITY_LIMITS.allowedTargets} 项`,
    );
  }
  const targets = input.map((item) => requireText(item, "allowedTargets", IDENTITY_LIMITS.id));
  return [...new Set(targets)];
}

export function createIdentityService(deps: IdentityServiceDeps): IdentityService {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const generateSecret = deps.newSecret ?? newSecret;
  const newAgentId = deps.newAgentId ?? (() => newPrefixedId("agt"));

  async function registerMachine(input: RegisterMachineInput): Promise<RegisteredMachine> {
    const id = requireText(input.id, "id", IDENTITY_LIMITS.id);
    const hostname = requireText(input.hostname, "hostname", IDENTITY_LIMITS.hostname);
    const os = requireText(input.os, "os", IDENTITY_LIMITS.os);
    const collectorVersion = requireText(
      input.collectorVersion,
      "collectorVersion",
      IDENTITY_LIMITS.collectorVersion,
    );
    if ((await findMachineById(db, id)) !== undefined) {
      throw new IdentityError("CONFLICT", `机器 ${id} 已注册;重置密钥请走轮换接口`);
    }
    const secret = generateSecret();
    await db.transaction(async (tx) => {
      await insertMachine(tx, {
        id,
        hostname,
        os,
        collectorVersion,
        collectorSecretHash: hashSecret(secret),
        createdAt: now(),
      });
    });
    const machine = await findMachineById(db, id);
    if (machine === undefined) {
      throw new Error(`机器注册后读不到记录: ${id}`);
    }
    return { machine, secret };
  }

  async function registerAgent(input: RegisterAgentInput): Promise<RegisteredAgent> {
    const project = requireText(input.project, "project", IDENTITY_LIMITS.project);
    const displayName = requireText(input.displayName, "displayName", IDENTITY_LIMITS.displayName);
    const feishuAppId =
      input.feishuAppId === undefined || input.feishuAppId === null || input.feishuAppId === ""
        ? null
        : requireText(input.feishuAppId, "feishuAppId", IDENTITY_LIMITS.id);
    const allowedTargetsJson = JSON.stringify(normalizeTargets(input.allowedTargets));

    let machineId: string | null;
    let runtime: AgentRuntime;
    if (input.machineId === null || input.machineId === undefined) {
      // 机器无关 Agent:无 aw-node 的外部运行时(WorkBuddy/Codex/DeepSeek harness),
      // machine_id 写 NULL,要求显式给出属于外部集合的 runtime。
      if (input.runtime === undefined || !(EXTERNAL_RUNTIMES as readonly AgentRuntime[]).includes(input.runtime)) {
        throw new IdentityError(
          "VALIDATION_FAILED",
          `机器无关 Agent 必须给出 runtime(属于 ${EXTERNAL_RUNTIMES.join(" / ")} 之一)`,
        );
      }
      machineId = null;
      runtime = input.runtime;
    } else {
      // 机器绑定 Agent:claude_code 经 aw-node 调度,强制校验机器存在与项目去重
      machineId = requireText(input.machineId, "machineId", IDENTITY_LIMITS.id);
      if (input.runtime !== undefined && input.runtime !== "claude_code") {
        throw new IdentityError(
          "VALIDATION_FAILED",
          `绑定机器的 Agent 只能是 claude_code 运行时,收到 ${input.runtime}`,
        );
      }
      if ((await findMachineById(db, machineId)) === undefined) {
        throw new IdentityError("NOT_FOUND", `机器 ${machineId} 未注册`);
      }
      if ((await findAgentByMachineProject(db, machineId, project)) !== undefined) {
        throw new IdentityError("CONFLICT", `机器 ${machineId} 下已存在项目 ${project} 的 Agent`);
      }
      runtime = "claude_code";
    }

    const id = newAgentId();
    const secret = generateSecret();
    await db.transaction(async (tx) => {
      await insertAgent(tx, {
        id,
        machineId,
        runtime,
        project,
        displayName,
        secretHash: hashSecret(secret),
        key: null,
        mcpConfigJson: null,
        bootstrapStatus: "registered",
        feishuAppId,
        allowedTargetsJson,
        createdAt: now(),
      });
    });
    const agent = await findAgentById(db, id);
    if (agent === undefined) {
      throw new Error(`Agent 注册后读不到记录: ${id}`);
    }
    return { agent, secret };
  }

  async function rotateMachineSecret(id: string): Promise<RegisteredMachine> {
    const secret = generateSecret();
    if (!(await updateMachineSecretHash(db, id, hashSecret(secret)))) {
      throw new IdentityError("NOT_FOUND", `机器 ${id} 未注册`);
    }
    const machine = await findMachineById(db, id);
    if (machine === undefined) {
      throw new Error(`机器轮换后读不到记录: ${id}`);
    }
    return { machine, secret };
  }

  async function rotateAgentSecret(id: string): Promise<RegisteredAgent> {
    const secret = generateSecret();
    if (!(await updateAgentSecretHash(db, id, hashSecret(secret), now()))) {
      throw new IdentityError("NOT_FOUND", `Agent ${id} 未注册`);
    }
    const agent = await findAgentById(db, id);
    if (agent === undefined) {
      throw new Error(`Agent 轮换后读不到记录: ${id}`);
    }
    return { agent, secret };
  }

  async function setAllowedTargets(id: string, targets: string[]): Promise<AgentRecord> {
    if ((await findAgentById(db, id)) === undefined) {
      throw new IdentityError("NOT_FOUND", `Agent ${id} 未注册`);
    }
    const normalized = normalizeTargets(targets);
    if (normalized.includes(id)) {
      throw new IdentityError("VALIDATION_FAILED", "不能委派给自身");
    }
    const unknown: string[] = [];
    for (const target of normalized) {
      if ((await findAgentById(db, target)) === undefined) {
        unknown.push(target);
      }
    }
    if (unknown.length > 0) {
      throw new IdentityError("VALIDATION_FAILED", `委派目标不存在: ${unknown.join(", ")}`);
    }
    if (!(await updateAgentAllowedTargets(db, id, JSON.stringify(normalized), now()))) {
      throw new IdentityError("NOT_FOUND", `Agent ${id} 未注册`);
    }
    const agent = await findAgentById(db, id);
    if (agent === undefined) {
      throw new Error(`Agent 更新后读不到记录: ${id}`);
    }
    return agent;
  }

  return {
    registerMachine,
    registerAgent,
    rotateMachineSecret,
    rotateAgentSecret,
    setAllowedTargets,
    listMachines: (query) => listMachines(db, query),
    listAgents: (query) => listAgents(db, query),
  };
}
