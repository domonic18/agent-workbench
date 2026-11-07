import type { FastifyReply } from "fastify";
import type { TaskError } from "../../domain/task/errors.js";
import type { AgentLabel } from "../../store/repositories/agent-lifecycle.js";
import type { TaskRecord } from "../../store/repositories/task.js";

export interface TaskDto {
  id: string;
  title: string;
  assigner: string;
  assignee: string;
  /** 展示用名:Agent 在册时给飞书机器人名(回退控制台显示名),已被硬删除时显示「已删除 Agent X」,不是 Agent 的值(aw-console / human)原样透出 */
  assigner_label: string;
  assignee_label: string;
  project: string;
  parent_task_id: string | null;
  /** 所属工作事项(业务事项);null 表示该任务不挂在任何事项下 */
  work_item_id: string | null;
  round: number;
  rework_count: number;
  stage: string;
  status: string;
  origin: string;
  deadline_at: number | null;
  output: string | null;
  started_at: number | null;
  ended_at: number | null;
  total_tokens: number;
  created_at: number;
  updated_at: number;
}

/**
 * 展示名:在册 Agent 取飞书机器人名(回退控制台显示名),已删除的加「已删除」前缀,
 * 不是 Agent 的值(aw-console / human / feishu:xxx)原样透出。
 */
function labelFor(id: string, labels: Map<string, AgentLabel> | undefined): string {
  const label = labels?.get(id);
  if (label === undefined) {
    return id;
  }
  if (label.deleted) {
    return `已删除 ${label.displayName}`;
  }
  return label.botName ?? label.displayName;
}

export function toTaskDto(row: TaskRecord, labels?: Map<string, AgentLabel>): TaskDto {
  return {
    id: row.id,
    title: row.title,
    assigner: row.assigner,
    assignee: row.assignee,
    assigner_label: labelFor(row.assigner, labels),
    assignee_label: labelFor(row.assignee, labels),
    project: row.project,
    parent_task_id: row.parentTaskId,
    work_item_id: row.workItemId,
    round: row.round,
    rework_count: row.reworkCount,
    stage: row.stage,
    status: row.status,
    origin: row.origin,
    deadline_at: row.deadlineAt,
    output: row.output,
    started_at: row.startedAt,
    ended_at: row.endedAt,
    total_tokens: row.totalTokens,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function sendError(reply: FastifyReply, error: TaskError): FastifyReply {
  return reply.code(error.status).send({
    error: {
      code: error.code,
      message: error.message,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    },
  });
}
