import { IDENTITY_LIMITS, type IdentityStatus } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import {
  countAgentDeleteImpact,
  deleteAgentCascade,
  updateAgentProfile,
  type AgentDeleteImpact,
} from "../../store/repositories/agent-lifecycle.js";
import {
  findAssembly,
  updateAssemblyPrimaryAgent,
} from "../../store/repositories/assembly.js";
import {
  findAgentById,
  findAgentByMachineProject,
  type AgentRecord,
} from "../../store/repositories/agent.js";
import { findMachineById } from "../../store/repositories/machine.js";
import { IdentityError } from "./errors.js";

export interface UpdateAgentInput {
  displayName?: string | undefined;
  project?: string | undefined;
  status?: IdentityStatus | undefined;
  /** 宿主机器:null 表示解绑(只允许外部运行时) */
  machineId?: string | null | undefined;
}

/** 删除前的影响预览:数字与实际级联口径一致 */
export interface AgentDeletionPreview {
  agent: {
    id: string;
    displayName: string;
    project: string;
    machineId: string | null;
    status: IdentityStatus;
  };
  impact: AgentDeleteImpact;
  /** 该 Agent 是全局默认 bug_fix 路由的主责:删除被拦,须先指定接替者 */
  bootstrapPrimary: boolean;
  /** 当前主责 Agent id(非主责时为 null) */
  bootstrapPrimaryAgentId: string | null;
}

export interface AgentDeletionResult {
  id: string;
  /** 幂等重放:本次未真正执行删除 */
  replayed: boolean;
  /** 改指后的主责 Agent(仅发生改指时非空) */
  bootstrapPrimaryReassignedTo: string | null;
}

export interface AgentLifecycleService {
  updateAgent(id: string, input: UpdateAgentInput): Promise<AgentRecord>;
  previewDeletion(id: string): Promise<AgentDeletionPreview>;
  deleteAgent(
    id: string,
    options: { reassignBootstrapPrimaryTo?: string | undefined },
  ): Promise<AgentDeletionResult>;
}

export interface AgentLifecycleDeps {
  db: Db;
  now?: () => number;
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

export function createAgentLifecycleService(deps: AgentLifecycleDeps): AgentLifecycleService {
  const { db } = deps;
  const now = deps.now ?? Date.now;

  async function requireAgent(id: string): Promise<AgentRecord> {
    const agent = await findAgentById(db, id);
    if (agent === undefined) {
      throw new IdentityError("NOT_FOUND", `Agent ${id} 未注册`);
    }
    return agent;
  }

  async function updateAgent(id: string, input: UpdateAgentInput): Promise<AgentRecord> {
    const agent = await requireAgent(id);
    const patch: {
      displayName?: string | undefined;
      project?: string | undefined;
      status?: IdentityStatus | undefined;
      machineId?: string | null | undefined;
    } = {};

    if (input.displayName !== undefined) {
      patch.displayName = requireText(input.displayName, "displayName", IDENTITY_LIMITS.displayName);
    }
    if (input.project !== undefined) {
      patch.project = requireText(input.project, "project", IDENTITY_LIMITS.project);
    }
    if (input.status !== undefined) {
      patch.status = input.status;
    }
    if (input.machineId !== undefined) {
      patch.machineId = await resolveMachineBinding(agent, input.machineId);
    }
    if (
      patch.displayName === undefined &&
      patch.project === undefined &&
      patch.status === undefined &&
      patch.machineId === undefined
    ) {
      throw new IdentityError("VALIDATION_FAILED", "至少要改一项");
    }

    // 机器绑定 Agent 的 (machine_id, project) 唯一:改项目或换机器前先查重
    const targetMachine = patch.machineId === undefined ? agent.machineId : patch.machineId;
    const targetProject = patch.project ?? agent.project;
    if (targetMachine !== null && targetMachine !== agent.machineId) {
      const clash = await findAgentByMachineProject(db, targetMachine, targetProject);
      if (clash !== undefined && clash.id !== id) {
        throw new IdentityError(
          "CONFLICT",
          `机器 ${targetMachine} 下已存在项目 ${targetProject} 的 Agent`,
        );
      }
    }
    if (
      patch.project !== undefined &&
      patch.project !== agent.project &&
      agent.machineId !== null
    ) {
      const clash = await findAgentByMachineProject(db, agent.machineId, patch.project);
      if (clash !== undefined && clash.id !== id) {
        throw new IdentityError(
          "CONFLICT",
          `机器 ${agent.machineId} 下已存在项目 ${patch.project} 的 Agent`,
        );
      }
    }

    if (!(await updateAgentProfile(db, id, patch, now()))) {
      throw new IdentityError("NOT_FOUND", `Agent ${id} 未注册`);
    }
    return requireAgent(id);
  }

  /**
   * 绑定/解绑宿主机器(2026-11-06 用户反馈:WorkBuddy 没有绑定机器的入口)。
   * claude_code 的机器绑定是采集与调度的前提,不可解绑;外部运行时绑定只登记归属,
   * 该机 aw-node 不接管它的过程数据。
   */
  async function resolveMachineBinding(
    agent: AgentRecord,
    machineId: string | null,
  ): Promise<string | null> {
    if (machineId === null) {
      if (agent.runtime === "claude_code") {
        throw new IdentityError(
          "VALIDATION_FAILED",
          "claude_code 运行时依赖该机 aw-node 采集与调度,不能解绑机器",
        );
      }
      return null;
    }
    const target = requireText(machineId, "machineId", IDENTITY_LIMITS.id);
    if ((await findMachineById(db, target)) === undefined) {
      throw new IdentityError("NOT_FOUND", `机器 ${target} 未注册`);
    }
    return target;
  }

  async function previewDeletion(id: string): Promise<AgentDeletionPreview> {
    const agent = await requireAgent(id);
    const assembly = await findAssembly(db);
    const impact = await countAgentDeleteImpact(db, id);
    return {
      agent: {
        id: agent.id,
        displayName: agent.displayName,
        project: agent.project,
        machineId: agent.machineId,
        status: agent.status,
      },
      impact,
      bootstrapPrimary: assembly?.primaryAgentId === id,
      bootstrapPrimaryAgentId: assembly?.primaryAgentId ?? null,
    };
  }

  async function deleteAgent(
    id: string,
    options: { reassignBootstrapPrimaryTo?: string | undefined },
  ): Promise<AgentDeletionResult> {
    await requireAgent(id);
    const assembly = await findAssembly(db);
    const isPrimary = assembly?.primaryAgentId === id;

    let reassignedTo: string | null = null;
    if (isPrimary) {
      const target = options.reassignBootstrapPrimaryTo;
      if (target === undefined || target === "") {
        throw new IdentityError(
          "CONFLICT",
          `Agent ${id} 是默认 bug_fix 路由的主责,删除前须指定接替者(reassignBootstrapPrimaryTo)`,
        );
      }
      if (target === id) {
        throw new IdentityError("VALIDATION_FAILED", "接替者不能是被删除的 Agent 自身");
      }
      const successor = await findAgentById(db, target);
      if (successor === undefined) {
        throw new IdentityError("NOT_FOUND", `接替者 Agent ${target} 不存在`);
      }
      if (successor.status !== "active") {
        throw new IdentityError("VALIDATION_FAILED", `接替者 Agent ${target} 未启用`);
      }
      reassignedTo = target;
    }

    await db.transaction(async (tx) => {
      if (reassignedTo !== null) {
        await updateAssemblyPrimaryAgent(tx, reassignedTo);
      }
      await deleteAgentCascade(tx, id, now());
    });

    return { id, replayed: false, bootstrapPrimaryReassignedTo: reassignedTo };
  }

  return { updateAgent, previewDeletion, deleteAgent };
}
