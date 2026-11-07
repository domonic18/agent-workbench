import { ApiError } from "./client.js";
import {
  fetchTask,
  fetchTaskEvents,
  type TaskDetailResponse,
  type TaskDto,
  type TaskEventDto,
  type TaskEventsResponse,
} from "./tasks.js";

export type ChainRelation = "a2a" | "continuation" | "unknown";

export interface TaskChainEntry {
  taskId: string;
  /** null 表示上游 id 存在但查不到任务记录,不拿 run 伪造节点(03 §4.2) */
  task: TaskDto | null;
  /** 本节点相对其父任务的关联;链头为 null */
  relation: ChainRelation | null;
}

export interface TaskChainResult {
  /** 链头 → 当前任务 */
  entries: TaskChainEntry[];
  /** 超过深度上限或检测到环,已在上游截断 */
  truncated: boolean;
}

export interface TaskChainLoaders {
  task: (id: string) => Promise<TaskDetailResponse>;
  events: (id: string) => Promise<TaskEventsResponse>;
}

const MAX_CHAIN_DEPTH = 10;

const defaultLoaders: TaskChainLoaders = {
  task: (id) => fetchTask(id),
  events: (id) => fetchTaskEvents(id, 0, 200),
};

/** handoff 事件是 parent_task_id 的事实来源:relation 只从该事件读,不做推断 */
export function relationFromEvents(
  events: readonly TaskEventDto[],
  parentId: string | null,
): ChainRelation | null {
  if (parentId === null) {
    return null;
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined || event.kind !== "handoff") {
      continue;
    }
    const reference = event.payload.from_task_id ?? event.payload.upstream_task_id;
    if (typeof reference === "string" && reference !== parentId) {
      continue;
    }
    const relation = event.payload.relation;
    if (relation === "a2a" || relation === "continuation") {
      return relation;
    }
    return "unknown";
  }
  return "unknown";
}

/**
 * 沿 parent_task_id 上溯。每一跳先查父任务详情再查父任务事件,
 * 父任务不存在时保留空节点并停止,不继续猜测更上游。
 */
export async function buildTaskChain(
  task: TaskDto,
  events: readonly TaskEventDto[],
  loaders: TaskChainLoaders = defaultLoaders,
): Promise<TaskChainResult> {
  const entries: TaskChainEntry[] = [
    { taskId: task.id, task, relation: relationFromEvents(events, task.parent_task_id) },
  ];
  const seen = new Set<string>([task.id]);
  let current = task;
  let truncated = false;

  while (current.parent_task_id !== null) {
    if (entries.length >= MAX_CHAIN_DEPTH) {
      truncated = true;
      break;
    }
    const parentId = current.parent_task_id;
    if (seen.has(parentId)) {
      truncated = true;
      break;
    }
    seen.add(parentId);

    try {
      const [detail, parentEvents] = await Promise.all([
        loaders.task(parentId),
        loaders.events(parentId),
      ]);
      entries.push({
        taskId: parentId,
        task: detail.task,
        relation: relationFromEvents(parentEvents.items, detail.task.parent_task_id),
      });
      current = detail.task;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        entries.push({ taskId: parentId, task: null, relation: null });
        break;
      }
      throw error;
    }
  }

  entries.reverse();
  return { entries, truncated };
}
