import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { githubWebhookToWorkRequest } from "../../adapters/github/webhook.js";
import { WorkIngestError } from "../../domain/work/contract.js";
import { createIngestService } from "../../domain/work/ingest-service.js";
import type { Db } from "../../store/database.js";

/**
 * GitHub Webhook 端点(arch/01 §9.1 可信 Source):HMAC 验签 → 归一化 →
 * ingest。无会话鉴权——身份由 X-Hub-Signature-256 证明;验签必须用
 * 原始请求体,故本作用域内以 buffer 呈递 JSON 后自行解析。
 */

export interface WebhookGithubOptions {
  db: Db;
  webhookSecret: string;
  now?: () => number;
}

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function verifyGithubSignature(
  secret: string,
  header: string | undefined,
  rawBody: Buffer,
): boolean {
  if (header === undefined || !header.startsWith("sha256=")) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  if (received.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(received, expected);
}

export function registerWebhookGithubRoutes(
  app: FastifyInstance,
  options: WebhookGithubOptions,
): void {
  const ingest = createIngestService({ db: options.db, now: options.now ?? Date.now }).ingest;

  app.register(async (scope) => {
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, body, done) => {
        try {
          const raw = body as Buffer;
          (request as RawBodyRequest).rawBody = raw;
          done(null, JSON.parse(raw.toString("utf8")));
        } catch (error) {
          (error as { statusCode?: number }).statusCode = 400;
          done(error as Error, undefined);
        }
      },
    );

    scope.post("/api/webhooks/github", async (request, reply) => {
      const rawBody = (request as RawBodyRequest).rawBody;
      if (rawBody === undefined) {
        return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "请求体不可用" } });
      }
      if (!verifyGithubSignature(options.webhookSecret, singleHeader(request.headers["x-hub-signature-256"]), rawBody)) {
        return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "签名校验失败" } });
      }
      const event = singleHeader(request.headers["x-github-event"]);
      const delivery = singleHeader(request.headers["x-github-delivery"]);
      if (event === undefined || delivery === undefined) {
        return reply.code(400).send({
          error: { code: "BAD_REQUEST", message: "缺少 X-GitHub-Event / X-GitHub-Delivery" },
        });
      }
      if (typeof request.body !== "object" || request.body === null || Array.isArray(request.body)) {
        return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "payload 必须是 JSON 对象" } });
      }

      const normalized = githubWebhookToWorkRequest(event, delivery, request.body as Record<string, unknown>, {
        now: options.now ?? Date.now,
      });
      if (normalized === null) {
        return reply.code(200).send({ ignored: true });
      }
      try {
        const result = await ingest(normalized);
        return {
          replayed: result.replayed,
          disposition: result.trigger.disposition,
          reasonCode: result.trigger.reasonCode,
          workItemId: result.trigger.workItemId,
        };
      } catch (error) {
        if (error instanceof WorkIngestError) {
          return reply.code(400).send({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }
    });
  });
}
