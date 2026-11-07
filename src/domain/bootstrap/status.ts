import { DEFAULT_BUG_FIX } from "./assembly.js";
import { findAssembly } from "../../store/repositories/assembly.js";
import type { Db } from "../../store/database.js";

export type BootstrapPhase =
  | "awaiting_machine"
  | "awaiting_agents"
  | "awaiting_completion"
  | "ready";

export interface BootstrapStatus {
  phase: BootstrapPhase;
  machines: number;
  agents: number;
  assembly: { primaryAgentId: string; workKind: string; assembledAt: number } | null;
  definition: typeof DEFAULT_BUG_FIX;
  next: string;
}

export interface BootstrapStatusService {
  getStatus(): Promise<BootstrapStatus>;
}

export interface BootstrapStatusDeps {
  db: Db;
}

function nextHint(phase: BootstrapPhase): string {
  if (phase === "awaiting_machine") {
    return "添加执行机:签发 enroll token 并在目标机执行安装命令";
  }
  if (phase === "awaiting_agents") {
    return "确认项目与主责 Agent";
  }
  return phase === "awaiting_completion"
    ? "核对默认 bug_fix 装配摘要,完成第 4 步初始化"
    : "初始化完成";
}

async function phaseOf(
  db: Db,
  machines: number,
  agents: number,
): Promise<BootstrapPhase> {
  if (machines === 0) {
    return "awaiting_machine";
  }
  if (agents === 0) {
    return "awaiting_agents";
  }
  return (await findAssembly(db)) === undefined ? "awaiting_completion" : "ready";
}

/**
 * bootstrap 状态查询应用服务:聚合机器 / Agent / 装配状态,供 /api/bootstrap/status 使用。
 */
export function createBootstrapStatusService(deps: BootstrapStatusDeps): BootstrapStatusService {
  const { db } = deps;
  return {
    async getStatus() {
      const machines = ((await db.get("SELECT COUNT(*)::int AS n FROM machine")) as { n: number }).n;
      const agents = ((await db.get("SELECT COUNT(*)::int AS n FROM agent")) as { n: number }).n;
      const phase = await phaseOf(db, machines, agents);
      const assembly = await findAssembly(db);
      return {
        phase,
        machines,
        agents,
        assembly:
          assembly === undefined
            ? null
            : {
                primaryAgentId: assembly.primaryAgentId,
                workKind: assembly.workKind,
                assembledAt: assembly.assembledAt,
              },
        definition: DEFAULT_BUG_FIX,
        next: nextHint(phase),
      };
    },
  };
}
