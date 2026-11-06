import type { Db } from "../database.js";

/** 装配记录是单例(id 恒为 1):初始化只装配一次,重复 complete 返回既有结果 */
export const ASSEMBLY_SINGLETON_ID = 1;

export interface AssemblyRecord {
  primaryAgentId: string;
  workKind: string;
  assembledAt: number;
}

export async function findAssembly(db: Db): Promise<AssemblyRecord | undefined> {
  const row = (await db.get(
    `SELECT primary_agent_id AS "primaryAgentId", work_kind AS "workKind",
            assembled_at AS "assembledAt"
       FROM bootstrap_assembly WHERE id = $1`,
    ASSEMBLY_SINGLETON_ID,
  )) as AssemblyRecord | undefined;
  return row;
}

/** 主责 Agent 被删除时改指接替者;装配记录本身保留(work_kind 与装配时刻是历史事实) */
export async function updateAssemblyPrimaryAgent(
  db: Db,
  primaryAgentId: string,
): Promise<boolean> {
  return (
    (
      await db.run(
        "UPDATE bootstrap_assembly SET primary_agent_id = ? WHERE id = ?",
        primaryAgentId, ASSEMBLY_SINGLETON_ID,
      )
    ).changes === 1
  );
}

export async function insertAssembly(
  db: Db,
  row: AssemblyRecord,
): Promise<void> {
  await db.run(
    `INSERT INTO bootstrap_assembly (id, primary_agent_id, work_kind, assembled_at)
     VALUES ($1, $2, $3, $4)`,
    ASSEMBLY_SINGLETON_ID, row.primaryAgentId, row.workKind, row.assembledAt,
  );
}
