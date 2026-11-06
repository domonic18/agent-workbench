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
} from "../../store/repositories/identity.js";
import { IdentityError } from "./errors.js";

export interface UpdateAgentInput {
  displayName?: string | undefined;
  project?: string | undefined;
  status?: IdentityStatus | undefined;
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
    if (patch.displayName === undefined && patch.project === undefined && patch.status === undefined) {
      throw new IdentityError("VALIDATION_FAILED", "至少要改一项");
    }

    // 机器绑定 Agent 的 (machine_id, project) 唯一:改项目前先查重
    if (patch.project !== undefined && patch.project !== agent.project && agent.machineId !== null) {
      const clash = await findAgentByMachineProject(db, agent.machineId, patch.project);
      if (clash !== undefined) {
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
