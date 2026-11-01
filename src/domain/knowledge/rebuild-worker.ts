import { parentPort, workerData } from "node:worker_threads";
import type { EmbeddingConfig } from "./embedding.js";

interface RebuildWorkerData {
  databasePath: string;
  knowledgeDir: string;
  embedding?: EmbeddingConfig;
}

async function main(): Promise<void> {
  // tsx 的解析钩子不进 worker:开发态入口是 .ts 时才注册,构建产物是 .js 直接跳过
  if (import.meta.url.endsWith(".ts")) {
    const { register } = await import("tsx/esm/api");
    register();
  }
  const { openDatabase } = await import("../../store/database.js");
  const { createEmbeddingClient } = await import("./embedding.js");
  const { rebuildKnowledgeIndex } = await import("./indexer.js");

  const data = workerData as RebuildWorkerData;
  const db = openDatabase(data.databasePath);
  try {
    const embedding =
      data.embedding === undefined ? undefined : createEmbeddingClient(data.embedding);
    const result = await rebuildKnowledgeIndex(db, {
      knowledgeDir: data.knowledgeDir,
      ...(embedding === undefined ? {} : { embedding }),
    });
    parentPort?.postMessage({ ok: true, result });
  } catch (error) {
    parentPort?.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    db.close();
  }
}

void main();
