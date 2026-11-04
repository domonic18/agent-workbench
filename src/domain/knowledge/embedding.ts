import { KNOWLEDGE_INDEX } from "../../shared/constants.js";

export interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
}

export interface EmbeddingClient {
  embed(texts: readonly string[]): Promise<Float32Array[]>;
}

interface EmbeddingResponse {
  data?: { embedding?: unknown }[];
  error?: { message?: unknown };
}

/** OpenAI 兼容 /embeddings;维度必须与 pgvector 列一致,不一致即失败而不是截断 */
export function createEmbeddingClient(config: EmbeddingConfig): EmbeddingClient {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/embeddings`;
  return {
    async embed(texts) {
      if (texts.length === 0) {
        return [];
      }
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.apiKey === undefined ? {} : { authorization: `Bearer ${config.apiKey}` }),
        },
        body: JSON.stringify({ model: config.model, input: texts }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await response.json().catch(() => ({}))) as EmbeddingResponse;
      if (!response.ok) {
        const detail =
          typeof body.error?.message === "string" ? body.error.message : `HTTP ${response.status}`;
        throw new Error(`嵌入服务失败: ${detail}`);
      }
      const data = body.data;
      if (!Array.isArray(data) || data.length !== texts.length) {
        throw new Error("嵌入服务返回条数与请求不一致");
      }
      return data.map((item, index) => {
        const vector = item.embedding;
        if (!Array.isArray(vector) || vector.length !== KNOWLEDGE_INDEX.dimensions) {
          throw new Error(
            `嵌入维度必须是 ${KNOWLEDGE_INDEX.dimensions},实际 ${Array.isArray(vector) ? vector.length : "未知"}`,
          );
        }
        return Float32Array.from(vector, (value) => {
          if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new Error(`嵌入向量第 ${index} 条含非法数值`);
          }
          return value;
        });
      });
    },
  };
}
