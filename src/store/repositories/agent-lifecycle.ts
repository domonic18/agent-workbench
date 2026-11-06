import type { IdentityStatus } from "../../shared/constants.js";
import type { Db } from "../database.js";

/** Agent 档案可改字段;其余列(机器绑定、密钥、路由 key)不由控制台会话改写 */
export interface AgentProfilePatch {
  displayName?: string | undefined;
  project?: string | undefined;
  status?: IdentityStatus | undefined;
}

/**
 * 改档案:只写传入的字段。
 * 机器绑定 Agent 改 project 会撞 (machine_id, project) 唯一约束,
 * 调用方先查重并翻译成 CONFLICT。
 */
export async function updateAgentProfile(
  db: Db,
  id: string,
  patch: AgentProfilePatch,
  now: number,
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.displayName !== undefined) {
    sets.push("display_name = ?");
    params.push(patch.displayName);
  }
  if (patch.project !== undefined) {
    sets.push("project = ?");
    params.push(patch.project);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (sets.length === 0) {
    return true;
  }
  sets.push("updated_at = ?");
  params.push(now);
  params.push(id);
  const result = await db.run(`UPDATE agent SET ${sets.join(", ")} WHERE id = ?`, ...params);
  return result.changes === 1;
}

/** 删除影响的三组计数:destroyed 会被删掉,detached 引用置空,retained 原样保留 */
export interface AgentDeleteImpact {
  destroyed: {
    workerInbox: number;
    a2aThread: number;
    a2aMessage: number;
    a2aDeadLetter: number;
    outboxPull: number;
    agentRun: number;
    timelineEvent: number;
    tokenUsage: number;
    usageLimit: number;
  };
  detached: {
    workTrigger: number;
    knowledgeEntry: number;
  };
  retained: {
    task: number;
    toolCallLog: number;
    workItem: number;
  };
}

/** SQL 扁平行 */
interface ImpactRow {
  workerInbox: number;
  a2aThread: number;
  a2aMessage: number;
  a2aDeadLetter: number;
  outboxPull: number;
  agentRun: number;
  timelineEvent: number;
  tokenUsage: number;
  usageLimit: number;
  workTrigger: number;
  knowledgeEntry: number;
  task: number;
  toolCallLog: number;
  workItem: number;
}

/**
 * 线程口径计数:该 Agent 参与的整条线程的消息都算销毁(含对端 Agent 的消息)。
 * 与级联删除的 SQL 口径一致,预览数字与实际结果不会打架。
 */
export async function countAgentDeleteImpact(db: Db, agentId: string): Promise<AgentDeleteImpact> {
  const row = (await db.get(
    `WITH threads AS (
       SELECT id FROM a2a_thread WHERE initiator_agent = $1 OR responder_agent = $1
     ),
     msgs AS (
       SELECT m.id FROM a2a_message m WHERE m.thread_id IN (SELECT id FROM threads)
     )
     SELECT
       (SELECT COUNT(*) FROM worker_inbox WHERE target_agent_id = $1) AS "workerInbox",
       (SELECT COUNT(*) FROM threads) AS "a2aThread",
       (SELECT COUNT(*) FROM msgs) AS "a2aMessage",
       (SELECT COUNT(*) FROM a2a_dead_letter WHERE msg_id IN (SELECT id FROM msgs)) AS "a2aDeadLetter",
       (SELECT COUNT(*) FROM outbox WHERE channel = 'pull' AND msg_id IN (SELECT id FROM msgs)) AS "outboxPull",
       (SELECT COUNT(*) FROM agent_run WHERE agent_id = $1) AS "agentRun",
       (SELECT COUNT(*) FROM timeline_event
         WHERE run_id IN (SELECT id FROM agent_run WHERE agent_id = $1)) AS "timelineEvent",
       (SELECT COUNT(*) FROM token_usage WHERE agent_id = $1) AS "tokenUsage",
       (SELECT COUNT(*) FROM usage_limit WHERE agent_id = $1) AS "usageLimit",
       (SELECT COUNT(*) FROM work_trigger WHERE target_agent_id = $1) AS "workTrigger",
       (SELECT COUNT(*) FROM knowledge_entry WHERE source_agent_id = $1) AS "knowledgeEntry",
       (SELECT COUNT(*) FROM task WHERE assignee = $1 OR assigner = $1) AS "task",
       (SELECT COUNT(*) FROM tool_call_log WHERE agent_id = $1) AS "toolCallLog",
       (SELECT COUNT(DISTINCT work_item_id) FROM agent_run
         WHERE agent_id = $1 AND work_item_id IS NOT NULL) AS "workItem"`,
    agentId,
  )) as ImpactRow | undefined;
  if (row === undefined) {
    throw new Error(`删除影响统计查不到行: ${agentId}`);
  }
  return {
    destroyed: {
      workerInbox: row.workerInbox,
      a2aThread: row.a2aThread,
      a2aMessage: row.a2aMessage,
      a2aDeadLetter: row.a2aDeadLetter,
      outboxPull: row.outboxPull,
      agentRun: row.agentRun,
      timelineEvent: row.timelineEvent,
      tokenUsage: row.tokenUsage,
      usageLimit: row.usageLimit,
    },
    detached: {
      workTrigger: row.workTrigger,
      knowledgeEntry: row.knowledgeEntry,
    },
    retained: {
      task: row.task,
      toolCallLog: row.toolCallLog,
      workItem: row.workItem,
    },
  };
}

/**
 * 硬删除级联(单事务内执行,调用方负责事务边界)。
 *
 * 顺序按外键依赖排:先删硬引用,再把可空引用置空,最后断 Agent 本体。
 * tool_call_log 是 append-only 审计,任何情况下都不删;task 的
 * assigner/assignee 是纯文本列,Agent 删掉后靠墓碑还原显示名。
 */
export async function deleteAgentCascade(
  db: Db,
  agentId: string,
  deletedAt: number,
): Promise<void> {
  // 派工信箱的 target_agent_id 是 NOT NULL,只能删
  await db.run("DELETE FROM worker_inbox WHERE target_agent_id = ?", agentId);
  // 触发事实与知识条目的引用可空:保留事实本身,只断开指向
  await db.run("UPDATE work_trigger SET target_agent_id = NULL WHERE target_agent_id = ?", agentId);
  await db.run("UPDATE knowledge_entry SET source_agent_id = NULL WHERE source_agent_id = ?", agentId);
  // A2A:死信与拉取出箱行先走,再断 reply_to 自引用,最后按线程删消息与线程
  await db.run(
    `DELETE FROM a2a_dead_letter WHERE msg_id IN (
       SELECT m.id FROM a2a_message m JOIN a2a_thread t ON t.id = m.thread_id
        WHERE t.initiator_agent = ? OR t.responder_agent = ?)`,
    agentId, agentId,
  );
  await db.run(
    `DELETE FROM outbox WHERE channel = 'pull' AND msg_id IN (
       SELECT m.id FROM a2a_message m JOIN a2a_thread t ON t.id = m.thread_id
        WHERE t.initiator_agent = ? OR t.responder_agent = ?)`,
    agentId, agentId,
  );
  await db.run(
    `UPDATE a2a_message SET reply_to_msg_id = NULL WHERE reply_to_msg_id IN (
       SELECT m.id FROM a2a_message m JOIN a2a_thread t ON t.id = m.thread_id
        WHERE t.initiator_agent = ? OR t.responder_agent = ?)`,
    agentId, agentId,
  );
  await db.run(
    `DELETE FROM a2a_message WHERE thread_id IN (
       SELECT id FROM a2a_thread WHERE initiator_agent = ? OR responder_agent = ?)`,
    agentId, agentId,
  );
  await db.run(
    "DELETE FROM a2a_thread WHERE initiator_agent = ? OR responder_agent = ?",
    agentId, agentId,
  );
  // 运行域:事件与 token 都以 run 为外键,必须先于 run 删除
  await db.run(
    "DELETE FROM timeline_event WHERE run_id IN (SELECT id FROM agent_run WHERE agent_id = ?)",
    agentId,
  );
  await db.run("DELETE FROM token_usage WHERE agent_id = ?", agentId);
  await db.run("DELETE FROM agent_run WHERE agent_id = ?", agentId);
  await db.run("DELETE FROM usage_limit WHERE agent_id = ?", agentId);
  // 墓碑留名:纯文本列(task.assignee / tool_call_log.agent_id)靠它显示「已删除 Agent X」
  await db.run(
    `INSERT INTO agent_tombstone (id, display_name, project, machine_id, runtime, deleted_at)
     SELECT id, display_name, project, machine_id, runtime, ? FROM agent WHERE id = ?`,
    deletedAt, agentId,
  );
  await db.run("DELETE FROM agent WHERE id = ?", agentId);
}

export interface AgentLabel {
  id: string;
  displayName: string;
  project: string;
  /** 已删除的 Agent 走墓碑,展示时加「已删除」前缀 */
  deleted: boolean;
}

/** 批量解析 Agent 展示名:在册取 agent,已删取墓碑,都没有则不进表 */
export async function resolveAgentLabels(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, AgentLabel>> {
  const labels = new Map<string, AgentLabel>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return labels;
  }
  const placeholders = unique.map((_, i) => `$${i + 1}`).join(", ");
  const rows = (await db.all(
    `SELECT id, display_name AS "displayName", project, false AS deleted
       FROM agent WHERE id IN (${placeholders})
     UNION ALL
     SELECT id, display_name AS "displayName", project, true AS deleted
       FROM agent_tombstone WHERE id IN (${placeholders})`,
    ...unique,
  )) as AgentLabel[];
  for (const row of rows) {
    labels.set(row.id, row);
  }
  return labels;
}
