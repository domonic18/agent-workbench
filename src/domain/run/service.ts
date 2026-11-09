import { RUN_IDLE_GAP_MS } from "../../shared/constants.js";
import { newPrefixedId } from "../../shared/ids.js";
import type { Db } from "../../store/database.js";
import {
  bindRunTaskIfEmpty,
  endRun,
  findLatestRunForStream,
  findRunningRunForStream,
  insertRun,
  insertTimelineEvent,
  maxBlockRev,
  touchRunLastSeen,
} from "../../store/repositories/run.js";

export interface RecordEventInput {
  agentId: string;
  machine: string;
  project: string;
  streamId: string;
  kind: string;
  occurredAt: number;
  ord: number;
  turnId?: string | null | undefined;
  blockId?: string | null | undefined;
  blockRev?: number | undefined;
  offset?: number | null | undefined;
  payload?: unknown;
}

export interface RecordEventResult {
  runId: string;
  eventId: string | null;
  /** 本次事件开出了新 run(首次事件或空闲 ≥30 分钟切分) */
  startedRun: boolean;
  /** block_rev 落后于该块当前新鲜度,事件被丢弃、不覆盖新内容 */
  staleRev: boolean;
}

export interface RunService {
  recordEvent(input: RecordEventInput): Promise<RecordEventResult>;
  /** 进程退出时收尾当前 run;没有 running run 返回 null */
  endStream(agentId: string, streamId: string, endedAt?: number): Promise<string | null>;
  /** run 内首次绑定任务;已绑定或 run 不存在返回 false */
  bindTask(runId: string, taskId: string): Promise<boolean>;
}

export interface RunServiceDeps {
  db: Db;
  now?: () => number;
  newRunId?: () => string;
  newEventId?: () => string;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} 必须是非空字符串`);
  }
  return value.trim();
}

function requireInteger(value: unknown, field: string, min: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new Error(`${field} 必须是 ≥${min} 的整数`);
  }
  return value;
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return requireText(value, field);
}

export function createRunService(deps: RunServiceDeps): RunService {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const newRunId = deps.newRunId ?? (() => newPrefixedId("run"));
  const newEventId = deps.newEventId ?? (() => newPrefixedId("tle"));

  async function recordEvent(input: RecordEventInput): Promise<RecordEventResult> {
    const agentId = requireText(input.agentId, "agentId");
    const machine = requireText(input.machine, "machine");
    const project = requireText(input.project, "project");
    const streamId = requireText(input.streamId, "streamId");
    const kind = requireText(input.kind, "kind");
    const occurredAt = requireInteger(input.occurredAt, "occurredAt", 1);
    const ord = requireInteger(input.ord, "ord", 1);
    const blockRev =
      input.blockRev === undefined ? 1 : requireInteger(input.blockRev, "blockRev", 1);
    const offset = input.offset === undefined || input.offset === null
      ? null
      : requireInteger(input.offset, "offset", 0);
    const turnId = optionalText(input.turnId, "turnId");
    const blockId = optionalText(input.blockId, "blockId");

    return db.transaction(async (tx): Promise<RecordEventResult> => {
      let run = await findRunningRunForStream(tx, agentId, streamId);
      let startedRun = false;

      // 空闲 ≥30 分钟:旧 run 停在最后一次活动,新事件顶替(02 §3.2)
      if (run !== undefined && occurredAt - run.lastSeenAt >= RUN_IDLE_GAP_MS) {
        await endRun(tx, run.id, run.lastSeenAt, "idle_split");
        run = undefined;
      }
      if (run === undefined) {
        // 迟到事件回填:流上最近 run 已收尾且事件发生在收尾时刻之前 → 落回原 run,
        // 不误开新 run(单流内按 seq 顺序投递,常态到不了这里;进程退出宣告早于
        // spool 末批事件时会命中,02 §3.2)
        const latest = await findLatestRunForStream(tx, agentId, streamId);
        if (
          latest !== undefined &&
          latest.status === "ended" &&
          latest.endedAt !== null &&
          occurredAt <= latest.endedAt
        ) {
          run = latest;
        }
      }
      if (run === undefined) {
        const created = {
          id: newRunId(),
          agentId,
          machine,
          project,
          streamId,
          startedAt: occurredAt,
        };
        await insertRun(tx, created);
        run = {
          ...created,
          taskId: null,
          status: "running",
          lastSeenAt: occurredAt,
          endedAt: null,
          endReason: null,
        };
        startedRun = true;
      }

      // 晚到事件不回拨 last_seen_at;它仍是 run 存活的证据
      if (occurredAt > run.lastSeenAt) {
        await touchRunLastSeen(tx, run.id, occurredAt);
      }

      // 旧 block_rev 不得覆盖新内容:直接丢弃,不做内容拼接猜测(02 §3.2)
      if (blockId !== null && blockRev < (await maxBlockRev(tx, run.id, blockId))) {
        return { runId: run.id, eventId: null, startedRun, staleRev: true };
      }

      const eventId = newEventId();
      await insertTimelineEvent(tx, {
        id: eventId,
        runId: run.id,
        turnId,
        blockId,
        ord,
        blockRev,
        offset,
        kind,
        payload: input.payload,
        occurredAt,
      });
      return { runId: run.id, eventId, startedRun, staleRev: false };
    });
  }

  async function endStream(agentId: string, streamId: string, endedAt?: number): Promise<string | null> {
    const run = await findRunningRunForStream(db, agentId, streamId);
    if (run === undefined) {
      return null;
    }
    const at = Math.max(run.lastSeenAt, endedAt ?? now());
    await endRun(db, run.id, at, "process_exit");
    return run.id;
  }

  async function bindTask(runId: string, taskId: string): Promise<boolean> {
    return bindRunTaskIfEmpty(
      db,
      requireText(runId, "runId"),
      requireText(taskId, "taskId"),
    );
  }

  return { recordEvent, endStream, bindTask };
}
