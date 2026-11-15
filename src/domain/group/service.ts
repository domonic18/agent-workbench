/**
 * 委派目标组:一组 Agent 作为一个委派收件方。
 *
 * 组只回答「谁能被某个 Agent 委派」——A 把 G 列为收件方 = A 能发给 G 的所有成员。
 * 它不参与派工、能力签发与任何其它判定。
 */
import { IdentityError } from "../identity/errors.js";
import { newPrefixedId } from "../../shared/ids.js";
import type { Db } from "../../store/database.js";
import { findAgentById, listAgents, updateAgentAllowedTargets } from "../../store/repositories/agent.js";
import {
  deleteGroup,
  findGroupById,
  insertGroup,
  listGroups,
  renameGroup,
  setGroupMembers,
} from "../../store/repositories/agent-group.js";
import { parseJsonStringArray } from "../../store/json.js";

export interface AgentGroupView {
  id: string;
  name: string;
  memberIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface GroupServiceDeps {
  db: Db;
  now?: () => number;
  newGroupId?: () => string;
}

const NAME_MAX = 64;

function requireName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new IdentityError("VALIDATION_FAILED", "组名不能为空");
  }
  if (trimmed.length > NAME_MAX) {
    throw new IdentityError("VALIDATION_FAILED", `组名超过 ${NAME_MAX} 字符`);
  }
  return trimmed;
}

export function createGroupService(deps: GroupServiceDeps) {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const newGroupId = deps.newGroupId ?? (() => newPrefixedId("grp"));

  async function list(): Promise<AgentGroupView[]> {
    return await listGroups(db);
  }

  /** 成员必须是已登记的 Agent:组里塞不存在的 id 等于白名单指向空气 */
  async function requireMembers(memberIds: readonly string[]): Promise<string[]> {
    const unique = [...new Set(memberIds)];
    const missing: string[] = [];
    for (const id of unique) {
      if ((await findAgentById(db, id)) === undefined) {
        missing.push(id);
      }
    }
    if (missing.length > 0) {
      throw new IdentityError("VALIDATION_FAILED", `组成员不存在: ${missing.join(", ")}`);
    }
    return unique;
  }

  async function create(input: {
    name: string;
    memberIds?: readonly string[] | undefined;
  }): Promise<AgentGroupView> {
    const name = requireName(input.name);
    const memberIds = await requireMembers(input.memberIds ?? []);
    const id = newGroupId();
    const at = now();
    await insertGroup(db, { id, name, createdAt: at });
    await setGroupMembers(db, id, memberIds, at);
    const group = await findGroupById(db, id);
    if (group === undefined) {
      throw new Error(`组 ${id} 建完读不到`);
    }
    return group;
  }

  async function update(
    id: string,
    input: { name?: string | undefined; memberIds?: readonly string[] | undefined },
  ): Promise<AgentGroupView> {
    const group = await findGroupById(db, id);
    if (group === undefined) {
      throw new IdentityError("NOT_FOUND", `组 ${id} 不存在`);
    }
    const at = now();
    if (input.name !== undefined) {
      await renameGroup(db, id, requireName(input.name), at);
    }
    if (input.memberIds !== undefined) {
      await setGroupMembers(db, id, await requireMembers(input.memberIds), at);
    }
    const updated = await findGroupById(db, id);
    if (updated === undefined) {
      throw new Error(`组 ${id} 更新后读不到`);
    }
    return updated;
  }

  /**
   * 删组:同时把各 Agent 白名单里的这个组 id 清掉。
   *
   * 不清就会留下悬空引用——组没了,白名单还指着它,判定会默默失配。
   */
  async function remove(id: string): Promise<void> {
    const group = await findGroupById(db, id);
    if (group === undefined) {
      throw new IdentityError("NOT_FOUND", `组 ${id} 不存在`);
    }
    const agents = await listAgents(db, { limit: 1000 });
    const at = now();
    for (const agent of agents) {
      const targets = parseJsonStringArray(agent.allowedTargetsJson);
      if (!targets.includes(id)) {
        continue;
      }
      const next = targets.filter((target) => target !== id);
      await updateAgentAllowedTargets(db, agent.id, JSON.stringify(next), at);
    }
    await deleteGroup(db, id);
  }

  return { list, create, update, remove };
}

export type GroupService = ReturnType<typeof createGroupService>;
