import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { EmbeddingConfig } from "./embedding.js";
import type { KnowledgeRebuildResult } from "./indexer.js";

/** 构建产物只有 .js;tsx 开发态直接跑 .ts,同一份代码两种入口都要能起来 */
function resolveWorkerEntry(): URL {
  const compiled = new URL("./rebuild-worker.js", import.meta.url);
  return existsSync(fileURLToPath(compiled))
    ? compiled
    : new URL("./rebuild-worker.ts", import.meta.url);
}

export interface KnowledgeRebuilderOptions {
  databasePath: string;
  knowledgeDir: string;
  embedding?: EmbeddingConfig;
}

export interface KnowledgeRebuilder {
  isRunning(): boolean;
  start(): Promise<KnowledgeRebuildResult>;
}

type WorkerMessage =
  | { ok: true; result: KnowledgeRebuildResult }
  | { ok: false; error: string };

export class KnowledgeRebuildBusyError extends Error {
  constructor() {
    super("索引重建正在进行");
    this.name = "KnowledgeRebuildBusyError";
  }
}

function run(options: KnowledgeRebuilderOptions): Promise<KnowledgeRebuildResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(resolveWorkerEntry(), {
      workerData: {
        databasePath: options.databasePath,
        knowledgeDir: options.knowledgeDir,
        ...(options.embedding === undefined ? {} : { embedding: options.embedding }),
      },
    });
    let settled = false;
    const settle = (action: () => void): void => {
      if (!settled) {
        settled = true;
        action();
      }
    };
    worker.once("message", (message: WorkerMessage) => {
      settle(() =>
        message.ok ? resolve(message.result) : reject(new Error(message.error)),
      );
      void worker.terminate();
    });
    worker.once("error", (error) => settle(() => reject(error)));
    worker.once("exit", (code) =>
      settle(() => reject(new Error(`索引重建进程异常退出: ${code}`))),
    );
  });
}

/** 重建放在 worker_thread,主进程事件循环与 HTTP 请求不被嵌入调用阻塞 */
export function createKnowledgeRebuilder(
  options: KnowledgeRebuilderOptions,
): KnowledgeRebuilder {
  let running: Promise<KnowledgeRebuildResult> | undefined;
  return {
    isRunning: () => running !== undefined,
    start() {
      if (running !== undefined) {
        return Promise.reject(new KnowledgeRebuildBusyError());
      }
      running = run(options).finally(() => {
        running = undefined;
      });
      return running;
    },
  };
}
