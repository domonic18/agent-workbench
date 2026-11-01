import type { FastifyReply } from "fastify";
import type { TaskError } from "../../domain/task/errors.js";
import type { TaskRecord } from "../../store/repositories/task.js";

export interface TaskDto {
  id: string;
  title: string;
  assigner: string;
  assignee: string;
  project: string;
  parent_task_id: string | null;
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

export function toTaskDto(row: TaskRecord): TaskDto {
  return {
    id: row.id,
    title: row.title,
    assigner: row.assigner,
    assignee: row.assignee,
    project: row.project,
    parent_task_id: row.parentTaskId,
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
