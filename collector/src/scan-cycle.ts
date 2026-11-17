import { statSync } from "node:fs";
import {
  loadAttributionIndex,
  overlayAttributionIndex,
  type AttributionIndex,
} from "./attribution.js";
import type { CollectorConfig } from "./config.js";
import type { Logger } from "./log.js";
import { appendEvents, ensureStream, pruneStreams } from "./scan.js";
import { classifyStream, listSessionFiles } from "./sessions.js";
import type { Spool } from "./spool.js";
import { saveState, streamIdFor, type PersistedState } from "./state.js";
import { readNewLines } from "./tailer.js";

const ATTRIBUTION_TTL_MS = 60_000;

export interface ScanCycleDeps {
  config: CollectorConfig;
  state: PersistedState;
  spool: Spool;
  registered: ReadonlySet<string>;
  /** 派发会话活引用:叠加进归因索引,登记即刻命中,不吃 60s 刷新 */
  dispatchSessions: Map<string, Set<string>>;
  /** 心跳活跃流(L2,04 §2):扫描读到新字节的流,下一跳上报豁免 L3 收敛 */
  activeSinceHeartbeat: Set<string>;
  logger: Logger;
  now: () => number;
}

export interface ScanCycle {
  /** 单轮扫描:枚举 → 归因 → 续读 → 落 spool → 剪枝 → 限额 → 存盘 */
  scanOnce(): Promise<void>;
}

/**
 * 采集扫描轮次(04 §2):从 daemon 抽出,只管「扫一轮」;
 * 生命周期与定时器留在 daemon,便于单测与行数约束。
 */
export function createScanCycle(deps: ScanCycleDeps): ScanCycle {
  const { config, state, spool, registered, dispatchSessions, activeSinceHeartbeat, logger, now } =
    deps;
  let index: AttributionIndex = overlayAttributionIndex(
    loadAttributionIndex(config.ccConnectDir),
    dispatchSessions,
  );
  let indexAt = 0;

  function refreshIndex(): void {
    const at = now();
    if (at - indexAt < ATTRIBUTION_TTL_MS) {
      return;
    }
    index = overlayAttributionIndex(loadAttributionIndex(config.ccConnectDir), dispatchSessions);
    indexAt = at;
  }

  async function scanOnce(): Promise<void> {
    refreshIndex();
    const files = listSessionFiles(config.claudeDir);
    for (const file of files) {
      const stream = ensureStream(file, state, config, now);
      const classified = classifyStream(index, file.sessionId, registered);
      if (classified.status !== stream.status || classified.project !== stream.project) {
        stream.status = classified.status;
        stream.project = classified.project;
        stream.updatedAt = now();
      }
      if (classified.status === "unattributed") {
        // 档 3:不推送也不计未归因;跳过历史,等它真的接上 cc-connect 再从当下开始
        try {
          stream.offset = statSync(file.path).size;
          stream.inode = statSync(file.path).ino;
        } catch {
          // 文件消失,保留原断点
        }
        continue;
      }
      const result = readNewLines(file.path, {
        inode: stream.inode,
        offset: stream.offset,
        epoch: stream.epoch,
      });
      if (result.missing) {
        continue;
      }
      if (result.rotated || result.truncated) {
        logger.warn("会话文件已轮转或截断,断点归零", {
          sessionId: stream.sessionId,
          epoch: result.epoch,
        });
        stream.epoch = result.epoch;
        stream.ackedSeq = 0;
        stream.lastSeq = 0;
      }
      stream.inode = result.inode;
      if (result.lines.length > 0) {
        appendEvents(stream, result.lines, spool, now);
        activeSinceHeartbeat.add(streamIdFor(stream.sessionId, stream.epoch));
      }
      stream.offset = result.offset;
      stream.updatedAt = now();
    }

    const pruned = pruneStreams(state, new Set(files.map((file) => file.path)));
    if (pruned > 0) {
      logger.info("清理已消失会话文件的状态条目", { pruned });
    }

    const dropped = spool.enforceLimit();
    if (dropped > 0) {
      logger.error("spool 超过上限,已丢弃最旧的未确认事件", { dropped });
    }
    saveState(config.stateDir, state);
  }

  return { scanOnce };
}
