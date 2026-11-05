import {
  RUN_IDLE_GAP_MS,
  TASK_LIMITS,
  type TaskStage,
  type TaskStatus,
} from "../../shared/constants.js";
import { newPrefixedId } from "../../shared/ids.js";
import type { Db } from "../../store/database.js";
import { findAgentById, type AgentRecord } from "../../store/repositories/identity.js";
import {
  bindRunTaskIfEmpty,
  findLatestUnboundRunningRunByAgent,
} from "../../store/repositories/run.js";
import {
  appendTaskEvent,
  findTaskById,
  insertTask,
  updateTask,
  type TaskRecord,
} from "../../store/repositories/task.js";
import {
  findWorkItemById,
} from "../../store/repositories/work-item.js";
import { hasActiveAssignment } from "../../store/repositories/work-inbox.js";
import type { CollabAgentRef, CompletionNotice } from "../collab/notice.js";
import { closeAncestorsIfComplete } from "./auto-close.js";
import { TaskError } from "./errors.js";
import {
  eventsForStatusChange,
  parseDeadline,
  parseOutput,
  requireText,
} from "./parse.js";
import {
  InvalidTransitionError,
  assertStageTransition,
  assertStatusTransition,
  isRework,
  nextReworkCount,
} from "./state-machine.js";

export interface TaskCreateInput {
  title: string;
  assigner: string;
  project: string;
  /** 由路由从 Bearer 身份注入,不接受请求体自述 */
  assignee: string;
  deadlineAt?: number | null | undefined;
  output?: string | null | undefined;
  parentTaskId?: string | null | undefined;
  /** 由事项承接而来的任务:须持有该事项的有效 assignment,origin 由服务端推导为 work_item */
  workItemId?: string | null | undefined;
}

export interface TaskUpdateInput {
  taskId: string;
  /** 由路由从 Bearer 身份注入,只能改自己的任务 */
  assignee: string;
  stage?: TaskStage | undefined;
  status?: TaskStatus | undefined;
  output?: string | null | undefined;
  deadlineAt?: number | null | undefined;
  reason?: string | undefined;
}

export interface TaskService {
  create(input: TaskCreateInput): Promise<TaskRecord>;
  /** 返回更新后的任务;autoClosed 是本轮沿 parent 链被系统收口的根任务(调用方据此发播报) */
  update(input: TaskUpdateInput): Promise<{ task: TaskRecord; autoClosed: TaskRecord[] }>;
  /** 下游任务完成时通知上游发起方;非 done、无父任务或同一 Agent 时返回 null */
  completionNotice(taskId: string): Promise<CompletionNotice | null>;
}

export interface TaskServiceDeps {
  db: Db;
  now?: () => number;
  newTaskId?: () => string;
  newEventId?: () => string;
}

export function createTaskService(deps: TaskServiceDeps): TaskService {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const newTaskId = deps.newTaskId ?? (() => newPrefixedId("tsk"));
  const newEventId = deps.newEventId ?? (() => newPrefixedId("tev"));

  /**
   * 「谁干活谁建单」落到具体 run:只认调用方最近活跃、尚未归属任务的 run。
   * 找不到活动 run(或已有归属)时静默跳过,不影响任务本身落库。
   */
  async function bindActiveRun(handle: Db, agentId: string, taskId: string, at: number): Promise<void> {
    const run = await findLatestUnboundRunningRunByAgent(handle, agentId, at - RUN_IDLE_GAP_MS);
    if (run !== undefined) {
      await bindRunTaskIfEmpty(handle, run.id, taskId);
    }
  }

  async function create(input: TaskCreateInput): Promise<TaskRecord> {
    const title = requireText(input.title, "title", TASK_LIMITS.title);
    const assigner = requireText(input.assigner, "assigner", TASK_LIMITS.assigner);
    const project = requireText(input.project, "project", TASK_LIMITS.project);
    const assignee = requireText(input.assignee, "assignee", TASK_LIMITS.assigner);
    const output = parseOutput(input.output);
    const deadlineAt = parseDeadline(input.deadlineAt);

    const workItemId =
      input.workItemId === undefined || input.workItemId === null || input.workItemId === ""
        ? null
        : requireText(input.workItemId, "workItemId", TASK_LIMITS.assigner);
    if (workItemId !== null) {
      const item = await findWorkItemById(db, workItemId);
      if (item === undefined) {
        throw new TaskError("NOT_FOUND", `工作事项 ${workItemId} 不存在`);
      }
      if (item.project !== project) {
        throw new TaskError("VALIDATION_FAILED", "任务项目与工作事项项目不一致");
      }
      if (!(await hasActiveAssignment(db, workItemId, assignee))) {
        throw new TaskError("FORBIDDEN", "未持有该工作事项的有效 assignment,不能建关联任务");
      }
    }
    const origin = workItemId === null ? "a2a" : "work_item";

    const parentTaskId =
      input.parentTaskId === undefined || input.parentTaskId === null || input.parentTaskId === ""
        ? null
        : requireText(input.parentTaskId, "parentTaskId", TASK_LIMITS.assigner);
    if (parentTaskId !== null) {
      const parent = await findTaskById(db, parentTaskId);
      if (parent === undefined) {
        throw new TaskError("NOT_FOUND", `父任务 ${parentTaskId} 不存在`);
      }
      if (parent.assignee !== assignee) {
        throw new TaskError("FORBIDDEN", "只能续接自己名下的任务");
      }
    }

    const id = newTaskId();
    const at = now();
    await db.transaction(async (tx) => {
      await insertTask(tx, {
        id,
        title,
        assigner,
        assignee,
        project,
        parentTaskId,
        origin,
        workItemId,
        deadlineAt,
        output,
        createdAt: at,
      });
      await appendTaskEvent(tx, {
        id: newEventId(),
        taskId: id,
        kind: "created",
        payload: { origin, assigner, project },
        occurredAt: at,
      });
      if (parentTaskId !== null) {
        await appendTaskEvent(tx, {
          id: newEventId(),
          taskId: id,
          kind: "handoff",
          payload: { relation: "continuation", from_task_id: parentTaskId },
          occurredAt: at,
        });
      }
      await bindActiveRun(tx, assignee, id, at);
    });

    const created = await findTaskById(db, id);
    if (created === undefined) {
      throw new Error(`任务创建后读不到记录: ${id}`);
    }
    return created;
  }

  async function update(input: TaskUpdateInput): Promise<{ task: TaskRecord; autoClosed: TaskRecord[] }> {
    const task = await findTaskById(db, input.taskId);
    if (task === undefined) {
      throw new TaskError("NOT_FOUND", `任务 ${input.taskId} 不存在`);
    }
    const assignee = requireText(input.assignee, "assignee", TASK_LIMITS.assigner);
    if (task.assignee !== assignee) {
      throw new TaskError("FORBIDDEN", "只能修改自己名下的任务");
    }

    const nextStage = input.stage ?? task.stage;
    const nextStatus = input.status ?? task.status;
    const stageChanged = nextStage !== task.stage;
    const statusChanged = nextStatus !== task.status;
    try {
      if (stageChanged) {
        assertStageTransition(task.stage, nextStage);
      }
      if (statusChanged) {
        assertStatusTransition(task.status, nextStatus);
      }
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        throw new TaskError("VALIDATION_FAILED", error.message, {
          dimension: error.dimension,
          from: error.from,
          to: error.to,
        });
      }
      throw error;
    }

    const output = input.output === undefined ? task.output : parseOutput(input.output);
    const deadlineAt =
      input.deadlineAt === undefined ? task.deadlineAt : parseDeadline(input.deadlineAt);
    const reason =
      input.reason === undefined ? null : requireText(input.reason, "reason", TASK_LIMITS.reason);
    const reworkCount = nextReworkCount(task.reworkCount, task.status, nextStatus);
    const rework = isRework(task.status, nextStatus);
    const at = now();
    const startedAt = task.startedAt ?? (nextStatus === "running" ? at : null);
    const endedAt =
      nextStatus === "done" || nextStatus === "cancelled" ? (task.endedAt ?? at) : task.endedAt;

    const autoClosed: TaskRecord[] = await db.transaction(async (tx) => {
      const applied = await updateTask(tx, {
        id: task.id,
        fromStage: task.stage,
        fromStatus: task.status,
        stage: nextStage,
        status: nextStatus,
        reworkCount,
        output,
        deadlineAt,
        startedAt,
        endedAt,
        updatedAt: at,
      });
      if (!applied) {
        throw new TaskError("CONFLICT", "任务已被并发修改,请重读后再试");
      }
      if (stageChanged) {
        await appendTaskEvent(tx, {
          id: newEventId(),
          taskId: task.id,
          kind: "stage_changed",
          payload: { from: task.stage, to: nextStage },
          occurredAt: at,
        });
      }
      if (rework) {
        await appendTaskEvent(tx, {
          id: newEventId(),
          taskId: task.id,
          kind: "rework",
          payload: { from: task.status, to: nextStatus, ...(reason === null ? {} : { reason }) },
          occurredAt: at,
        });
      } else if (statusChanged) {
        const kind = eventsForStatusChange(nextStatus);
        if (kind !== null) {
          await appendTaskEvent(tx, {
            id: newEventId(),
            taskId: task.id,
            kind,
            // 阻塞原因必须落在 blocked 事件上,否则控制台只能显示「未记录」
            payload: {
              from: task.status,
              to: nextStatus,
              ...(kind === "blocked" && reason !== null ? { reason } : {}),
            },
            occurredAt: at,
          });
        }
      }
      // 续接 / 返工可能换了新 run:未收尾的任务同样补一次绑定
      if (nextStatus !== "done" && nextStatus !== "cancelled") {
        await bindActiveRun(tx, task.assignee, task.id, at);
      }
      // 下游落终态后沿 parent 链自动收口(2026-11-02 裁决):验收 = 回执确认,系统代关单
      return nextStatus === "done" || nextStatus === "cancelled"
        ? closeAncestorsIfComplete(tx, task.id, at)
        : [];
    });

    const updated = await findTaskById(db, task.id);
    if (updated === undefined) {
      throw new Error(`任务更新后读不到记录: ${task.id}`);
    }
    return { task: updated, autoClosed };
  }

  function agentRef(agent: AgentRecord): CollabAgentRef {
    return { id: agent.id, displayName: agent.displayName };
  }

  async function completionNotice(taskId: string): Promise<CompletionNotice | null> {
    const task = await findTaskById(db, taskId);
    if (task === undefined || task.status !== "done" || task.parentTaskId === null) {
      return null;
    }
    const parent = await findTaskById(db, task.parentTaskId);
    if (parent === undefined || parent.assignee === task.assignee) {
      return null;
    }
    const from = await findAgentById(db, task.assignee);
    const to = await findAgentById(db, parent.assignee);
    if (from === undefined || to === undefined) {
      return null;
    }
    return {
      taskId: task.id,
      title: task.title,
      from: agentRef(from),
      to: agentRef(to),
    };
  }

  return { create, update, completionNotice };
}
