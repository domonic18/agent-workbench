/**
 * 委派目标的解析与判定:白名单里既可能有 Agent id,也可能有组 id。
 *
 * 判定只有一处(`a2a.send` 的强制点),展示侧(peers 接口、被拒时的可达目标回带)
 * 复用同一套展开逻辑——三处各写一份必然对不上。
 */
import type { Db } from "../../store/database.js";
import { findAgentById, type AgentRecord } from "../../store/repositories/agent.js";
import { listGroupIdsByAgent, listGroupsByIds } from "../../store/repositories/agent-group.js";

export interface ResolvedTarget {
  agent: AgentRecord;
  /** 经哪个组可达;直接授权时为 null */
  viaGroupId: string | null;
  viaGroupName: string | null;
}

/**
 * 把白名单里的目标引用展开成 Agent 列表。
 *
 * 组展开成它的全部成员;同一个 Agent 既被直接授权又在组里时,保留直接授权那条
 * (「你为什么能发给他」以最直接的那条为准)。
 */
export async function resolveTargets(
  db: Db,
  targetIds: readonly string[],
): Promise<ResolvedTarget[]> {
  const resolved = new Map<string, ResolvedTarget>();
  const groups = await listGroupsByIds(
    db,
    targetIds.filter((id) => !resolved.has(id)),
  );
  const groupIds = new Set(groups.map((group) => group.id));

  for (const id of targetIds) {
    if (groupIds.has(id)) {
      continue;
    }
    const agent = await findAgentById(db, id);
    if (agent !== undefined) {
      resolved.set(agent.id, { agent, viaGroupId: null, viaGroupName: null });
    }
  }

  for (const group of groups) {
    for (const memberId of group.memberIds) {
      if (resolved.has(memberId)) {
        continue;
      }
      const agent = await findAgentById(db, memberId);
      if (agent === undefined) {
        continue;
      }
      resolved.set(agent.id, {
        agent,
        viaGroupId: group.id,
        viaGroupName: group.name,
      });
    }
  }

  return [...resolved.values()];
}

/**
 * 发起方能不能发给这个 Agent。
 *
 * 直接授权命中,或该 Agent 属于发起方白名单里任一组的成员。
 */
export async function canReachAgent(
  db: Db,
  senderTargets: readonly string[],
  targetAgentId: string,
): Promise<boolean> {
  if (senderTargets.includes(targetAgentId)) {
    return true;
  }
  const groups = await listGroupsByIds(db, senderTargets);
  const groupIds = groups.map((group) => group.id);
  if (groupIds.length === 0) {
    return false;
  }
  const memberOf = await listGroupIdsByAgent(db, targetAgentId);
  return groupIds.some((groupId) => memberOf.includes(groupId));
}

/** 展开成 Agent id 列表(错误回带「可达目标」用) */
export async function reachableAgentIds(
  db: Db,
  senderTargets: readonly string[],
): Promise<string[]> {
  const resolved = await resolveTargets(db, senderTargets);
  return resolved.map((item) => item.agent.id);
}
