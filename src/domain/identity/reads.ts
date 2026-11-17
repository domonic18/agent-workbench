import type { Db } from "../../store/database.js";
import { findAgentById, findAgentByMachineProject, type AgentRecord } from "../../store/repositories/agent.js";
import {
  listAgentRosterRows,
  type AgentRosterQuery,
  type AgentRosterRow,
} from "../../store/repositories/agent-roster.js";
import {
  listTimelineEventsByAgent,
  type AgentTimelineRow,
} from "../../store/repositories/agent-timeline.js";
import {
  findMachineById,
  type MachineRecord,
} from "../../store/repositories/machine.js";
import {
  findUsageLimitByAgentId,
  findUsageLimitsByAgentIds,
  type UsageLimitRecord,
} from "../../store/repositories/usage-limit.js";

export interface AgentRosterPage {
  rows: AgentRosterRow[];
  limits: Map<string, UsageLimitRecord>;
}

/**
 * 身份域读路径(arch/00 §分层纪律:路由不直连库):
 * 存在性查证、名册页装配、Agent 对话流分页——薄读不带动静,
 * 与写路径的 IdentityService 分文件,各自守行数上限。
 */
export interface IdentityReads {
  findAgent(id: string): Promise<AgentRecord | undefined>;
  findMachine(id: string): Promise<MachineRecord | undefined>;
  /** 按 (机器, 项目) 定位 Agent:run-end 宣告等机器面入口用 */
  findAgentByMachine(machineId: string, project: string): Promise<AgentRecord | undefined>;
  /** 名册页:行 + 各行当前用量上限(装配在服务,路由只做 DTO 映射) */
  listRoster(query: AgentRosterQuery): Promise<AgentRosterPage>;
  /** 单 Agent 用量上限;无上限行返回 undefined(无限量) */
  findUsageLimit(agentId: string): Promise<UsageLimitRecord | undefined>;
  /** Agent 对话流事件页(03 §4.10):倒序取数,多取一条由调用方判断翻页 */
  agentTimeline(
    agentId: string,
    query: { limit: number; before?: { occurredAt: number; id: string } },
  ): Promise<AgentTimelineRow[]>;
}

export function createIdentityReads(db: Db): IdentityReads {
  async function findAgent(id: string): Promise<AgentRecord | undefined> {
    return findAgentById(db, id);
  }

  async function findMachine(id: string): Promise<MachineRecord | undefined> {
    return findMachineById(db, id);
  }

  async function findAgentByMachine(
    machineId: string,
    project: string,
  ): Promise<AgentRecord | undefined> {
    return findAgentByMachineProject(db, machineId, project);
  }

  async function listRoster(query: AgentRosterQuery): Promise<AgentRosterPage> {
    const rows = await listAgentRosterRows(db, query);
    const limits = await findUsageLimitsByAgentIds(
      db,
      rows.map((row) => row.id),
    );
    return { rows, limits };
  }

  async function findUsageLimit(agentId: string): Promise<UsageLimitRecord | undefined> {
    return findUsageLimitByAgentId(db, agentId);
  }

  async function agentTimeline(
    agentId: string,
    query: { limit: number; before?: { occurredAt: number; id: string } },
  ): Promise<AgentTimelineRow[]> {
    return listTimelineEventsByAgent(db, {
      agentId,
      limit: query.limit,
      ...(query.before === undefined ? {} : { before: query.before }),
    });
  }

  return {
    findAgent,
    findMachine,
    findAgentByMachine,
    listRoster,
    findUsageLimit,
    agentTimeline,
  };
}
