import { createHash } from "node:crypto";
import { INGEST_REJECTED_KIND, INGEST_TOKEN_USAGE_KIND } from "../../shared/constants.js";
import type { Db } from "../../store/database.js";
import { findAgentByMachineProject } from "../../store/repositories/agent.js";
import { hasIngestReceipt, insertIngestReceipt } from "../../store/repositories/ingest-receipt.js";
import { createRunService, type RunService } from "../run/service.js";
import { createTokenUsageService, type TokenUsageService } from "../usage/service.js";
import { IngestError } from "./errors.js";

const DEFAULT_TOKEN_SOURCE = "assistant_message";

export interface IngestItem {
  seq: number;
  kind: string;
  occurredAt: number;
  payload: unknown;
}

export interface IngestBatchInput {
  collectorId: string;
  agentProject: string;
  streamId: string;
  items: IngestItem[];
}

export interface IngestBatchResult {
  /** 已处理到的最新 seq;0 表示一条都没成功 */
  ackedSeq: number;
  processed: number;
  skipped: number;
  /** 被拒(内容存不下)并跳过的项数;这些项已留痕,不算丢事件 */
  rejected: number;
  /** 首个失败项;批次在此停止,后续不再写入 */
  failed: { seq: number; message: string } | null;
}

export interface IngestService {
  ingestBatch(input: IngestBatchInput): Promise<IngestBatchResult>;
}

export interface IngestServiceDeps {
  db: Db;
  now?: () => number;
  runService?: RunService;
  tokenService?: TokenUsageService;
}

interface TokenPayload {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  source: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readText(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new IngestError("BAD_REQUEST", `payload.${key} 必须是非空字符串`);
  }
  return value;
}

function readOptionalText(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new IngestError("BAD_REQUEST", `payload.${key} 必须是非空字符串`);
  }
  return value;
}

function readCount(payload: Record<string, unknown>, key: string): number {
  const value = payload[key] ?? 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new IngestError("BAD_REQUEST", `payload.${key} 必须是非负整数`);
  }
  return value;
}

function readOptionalInteger(
  payload: Record<string, unknown>,
  key: string,
  min: number,
): number | undefined {
  const value = payload[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new IngestError("BAD_REQUEST", `payload.${key} 必须是 ≥${min} 的整数`);
  }
  return value;
}

function parseTokenPayload(value: unknown): TokenPayload {
  const payload = asRecord(value);
  return {
    provider: readText(payload, "provider"),
    model: readText(payload, "model"),
    inputTokens: readCount(payload, "input_tokens"),
    outputTokens: readCount(payload, "output_tokens"),
    cacheReadTokens: readCount(payload, "cache_read_tokens"),
    cacheCreationTokens: readCount(payload, "cache_creation_tokens"),
    source: readOptionalText(payload, "source") ?? DEFAULT_TOKEN_SOURCE,
  };
}

/** 重试会原样重发同一行,内容哈希据此判断「同键是否同内容」 */
function receiptHashOf(item: IngestItem): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: item.kind,
        occurredAt: item.occurredAt,
        payload: item.payload ?? {},
      }),
    )
    .digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 单批最多跳过的坏项数;超过说明是系统性故障,整批停下等重试,不静默丢数据 */
const MAX_REJECTED_PER_BATCH = 5;

function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * 毒丸错误:内容本身不合法(业务校验失败、PG 数据类错误)。
 * 这类错误重试多少次结果都一样,继续挡住整条流只会让后面的事件永远收不上来。
 */
function isPoisonError(error: unknown): boolean {
  if (error instanceof IngestError) {
    return true;
  }
  const code = pgErrorCode(error);
  return code !== undefined && (code.startsWith("22") || code.startsWith("23"));
}

export function createIngestService(deps: IngestServiceDeps): IngestService {
  const { db } = deps;
  const now = deps.now ?? Date.now;

  async function ingestBatch(input: IngestBatchInput): Promise<IngestBatchResult> {
    const agent = await findAgentByMachineProject(db, input.collectorId, input.agentProject);
    if (agent === undefined || agent.status !== "active") {
      throw new IngestError(
        "BAD_REQUEST",
        `agent_project ${input.agentProject} 未登记或已停用`,
      );
    }

    let ackedSeq = 0;
    let processed = 0;
    let skipped = 0;
    let rejected = 0;

    for (const item of input.items) {
      const key = {
        collectorId: input.collectorId,
        streamId: input.streamId,
        seq: item.seq,
      };
      if (await hasIngestReceipt(db, key)) {
        skipped += 1;
        ackedSeq = item.seq;
        continue;
      }

      try {
        await db.transaction(async (tx) => {
          // 注入的服务可能绑定外部句柄;默认以 tx 重建,保证事件/用量/回执同一事务域
          const txRunService = deps.runService ?? createRunService({ db: tx });
          const txTokenService = deps.tokenService ?? createTokenUsageService({ db: tx });
          const payload = asRecord(item.payload);
          const recorded = await txRunService.recordEvent({
            agentId: agent.id,
            machine: input.collectorId,
            project: input.agentProject,
            streamId: input.streamId,
            kind: item.kind,
            occurredAt: item.occurredAt,
            ord: readOptionalInteger(payload, "ord", 1) ?? item.seq,
            turnId: readOptionalText(payload, "turn_id"),
            blockId: readOptionalText(payload, "block_id"),
            blockRev: readOptionalInteger(payload, "block_rev", 1) ?? 1,
            offset: readOptionalInteger(payload, "offset", 0) ?? null,
            payload: item.payload,
          });

          if (item.kind === INGEST_TOKEN_USAGE_KIND) {
            const usage = parseTokenPayload(item.payload);
            await txTokenService.record({
              agentId: agent.id,
              runId: recorded.runId,
              provider: usage.provider,
              model: usage.model,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadTokens: usage.cacheReadTokens,
              cacheCreationTokens: usage.cacheCreationTokens,
              source: usage.source,
              sequence: item.seq,
              receiptHash: receiptHashOf(item),
              occurredAt: item.occurredAt,
            });
          }

          await insertIngestReceipt(tx, { ...key, receivedAt: now() });
        });
      } catch (error) {
        const message = errorMessage(error);
        // 瞬时错误(连接、死锁):整批停下,采集器重试,事件不丢
        if (!isPoisonError(error) || rejected >= MAX_REJECTED_PER_BATCH) {
          return {
            ackedSeq,
            processed,
            skipped,
            rejected,
            failed: { seq: item.seq, message },
          };
        }
        // 毒丸项:内容本身存不下,跳过并留痕,不让一条坏事件堵死整条流
        await db.transaction(async (tx) => {
          const txRunService = deps.runService ?? createRunService({ db: tx });
          await txRunService.recordEvent({
            agentId: agent.id,
            machine: input.collectorId,
            project: input.agentProject,
            streamId: input.streamId,
            kind: INGEST_REJECTED_KIND,
            occurredAt: item.occurredAt,
            ord: item.seq,
            turnId: null,
            blockId: null,
            blockRev: 1,
            offset: null,
            payload: { kind: item.kind, seq: item.seq, error: message },
          });
          await insertIngestReceipt(tx, { ...key, receivedAt: now() });
        });
        rejected += 1;
        ackedSeq = item.seq;
        continue;
      }

      processed += 1;
      ackedSeq = item.seq;
    }

    return { ackedSeq, processed, skipped, rejected, failed: null };
  }

  return { ingestBatch };
}
