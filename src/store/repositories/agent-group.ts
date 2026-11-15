import type { Db } from "../database.js";

export interface AgentGroupRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** 列出全部组及其成员(成员 id 按名称排序,便于前端稳定渲染) */
export async function listGroups(db: Db): Promise<Array<AgentGroupRecord & { memberIds: string[] }>> {
  const rows = (await db.all(
    `SELECT g.id, g.name, g.created_at AS "createdAt", g.updated_at AS "updatedAt",
            m.agent_id AS "agentId"
       FROM agent_group g
       LEFT JOIN agent_group_member m ON m.group_id = g.id
      ORDER BY g.name, m.agent_id`,
  )) as Array<{ id: string; name: string; createdAt: number; updatedAt: number; agentId: string | null }>;
  const groups = new Map<string, AgentGroupRecord & { memberIds: string[] }>();
  for (const row of rows) {
    const group = groups.get(row.id) ?? {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      memberIds: [],
    };
    if (row.agentId !== null) {
      group.memberIds.push(row.agentId);
    }
    groups.set(row.id, group);
  }
  return [...groups.values()];
}

export async function findGroupById(
  db: Db,
  id: string,
): Promise<(AgentGroupRecord & { memberIds: string[] }) | undefined> {
  const groups = await listGroups(db);
  return groups.find((group) => group.id === id);
}

/** 查一组 id 对应的组(判定展开时用) */
export async function listGroupsByIds(
  db: Db,
  ids: readonly string[],
): Promise<Array<AgentGroupRecord & { memberIds: string[] }>> {
  if (ids.length === 0) return [];
  const groups = await listGroups(db);
  const wanted = new Set(ids);
  return groups.filter((group) => wanted.has(group.id));
}

/** 某 Agent 所属的组 id 列表 */
export async function listGroupIdsByAgent(db: Db, agentId: string): Promise<string[]> {
  const rows = (await db.all(
    "SELECT group_id AS \"groupId\" FROM agent_group_member WHERE agent_id = ?",
    agentId,
  )) as Array<{ groupId: string }>;
  return rows.map((row) => row.groupId);
}

/** 多个 Agent 各自所属的组 id(展开发起方白名单里的组用) */
export async function listGroupIdsByAgents(
  db: Db,
  agentIds: readonly string[],
): Promise<Set<string>> {
  if (agentIds.length === 0) return new Set();
  const rows = (await db.all(
    `SELECT DISTINCT group_id AS "groupId" FROM agent_group_member WHERE agent_id = ANY($1)`,
    agentIds,
  )) as Array<{ groupId: string }>;
  return new Set(rows.map((row) => row.groupId));
}

export async function insertGroup(
  db: Db,
  row: { id: string; name: string; createdAt: number },
): Promise<void> {
  await db.run(
    "INSERT INTO agent_group (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
    row.id, row.name, row.createdAt, row.createdAt,
  );
}

export async function renameGroup(db: Db, id: string, name: string, now: number): Promise<boolean> {
  return (
    (await db.run("UPDATE agent_group SET name = ?, updated_at = ? WHERE id = ?", name, now, id))
      .changes === 1
  );
}

/** 整包覆盖成员:先清后插,一次调用即最终状态 */
export async function setGroupMembers(
  db: Db,
  id: string,
  memberIds: readonly string[],
  now: number,
): Promise<void> {
  await db.run("DELETE FROM agent_group_member WHERE group_id = ?", id);
  for (const agentId of memberIds) {
    await db.run(
      "INSERT INTO agent_group_member (group_id, agent_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
      id, agentId,
    );
  }
  await db.run("UPDATE agent_group SET updated_at = ? WHERE id = ?", now, id);
}

export async function deleteGroup(db: Db, id: string): Promise<boolean> {
  return (await db.run("DELETE FROM agent_group WHERE id = ?", id)).changes === 1;
}
