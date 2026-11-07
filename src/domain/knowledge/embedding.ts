export interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
}

export interface EmbeddingClient {
  embed(texts: readonly string[]): Promise<Float32Array[]>;
}
