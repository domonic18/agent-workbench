 258   Type 'Promise<Db>' is missing the following properties from type 'Db': query, get, all, run, and 3 more.
  19 src/store/repositories/outbox.ts
  11 src/store/repositories/task.ts
  11 src/store/repositories/knowledge.ts
  10 src/store/repositories/identity.ts
  10 src/store/repositories/a2a.ts
  10 src/domain/usage/service.ts
   9 src/store/repositories/run.ts
   9 src/domain/knowledge/entry-service.ts
   9 src/domain/capability/service.ts
   9   Type 'Promise<KnowledgeEntryRecord | undefined>' is missing the following properties from type 'KnowledgeEntryRecord': id, path, title, summary, and 9 more.
   7 src/store/repositories/capability.ts
   6 src/server/main.ts
   5 src/store/repositories/token-usage.ts
   5 src/domain/identity/service.ts
   4 src/store/repositories/knowledge-vector.ts
   4 src/store/repositories/audit-reconcile.ts
   4 src/server/routes/a2a.ts
   4 src/server/login-lockout.ts
   4 src/server/credential.ts
   4 src/domain/knowledge/index-service.ts
   4 src/adapters/teleport/tctl.ts
   4   Type 'Promise<
   3 src/store/repositories/session.ts
   3 src/store/repositories/ingest-receipt.ts
   3 src/server/routes/task.ts
   3 src/server/middleware/machine-auth.ts
   3 src/server/middleware/agent-auth.ts
   3 src/domain/ingest/service.ts
   3 src/domain/a2a/service.ts
   3 src/domain/a2a/dead-letter.ts
   3 src/adapters/feishu/reply.ts
   3   Type 'Promise<Replyer>' has no call signatures.
   2 src/store/repositories/overview.ts
   2 src/store/repositories/login-lockout.ts
   2 src/store/repositories/idempotency.ts
   2 src/store/repositories/feishu-event.ts
   2 src/store/database.ts
   2 src/server/routes/knowledge.ts
   2 src/domain/run/service.ts
   2 src/domain/knowledge/rebuild-worker.ts
   2 src/domain/knowledge/embedding.ts
   2 src/adapters/feishu/command-handler.ts
   2 src/adapters/feishu/client.ts
   2   Type 'Promise<Gateway>' is missing the following properties from type 'Gateway': listTools, callTool
   2   Type 'Promise<Db>' is missing the following properties from type 'Database': memory, readonly, name, open, and 14 more.
   1 src/store/repositories/tool-call-log.ts
   1 src/store/repositories/revision.ts
   1 src/store/repositories/feishu-command.ts
   1 src/server/routes/capabilities.ts
   1 src/server/routes/audit.ts
   1 src/mcp/proxy/main.ts
   1 src/mcp/proxy/gateway.ts
   1 src/domain/task/service.ts
   1 src/domain/security/idempotency.ts
   1 src/domain/knowledge/indexer.ts
   1 src/domain/capability/audit-reconcile.ts
   1 src/adapters/teleport/audit.ts
   1   Types of property 'reply' are incompatible.
   1   Types of property 'embedding' are incompatible.
   1   Type 'number' is not assignable to type 'Promise<unknown>'.
   1   Type 'boolean' is not assignable to type 'Promise<unknown>'.
   1   Type 'RecordTokenUsageResult' is not assignable to type 'Promise<unknown>'.
   1   Type 'RecordEventResult' is missing the following properties from type 'Promise<unknown>': then, catch, finally, [Symbol.toStringTag]
   1   Type 'Promise<TaskRecord[]>' is missing the following properties from type 'TaskRecord[]': length, pop, push, concat, and 35 more.
   1   Type 'Promise<T>' is not assignable to type 'T'.
   1   Type 'Promise<Replyer>' provides no match for the signature '
   1   Type 'Promise<HandoffNotice | null>' is missing the following properties from type 'HandoffNotice': msgId, taskId, threadId, summary, and 2 more.
   1   Type 'Promise<AcceptNotice | null>' is missing the following properties from type 'AcceptNotice': msgId, taskId, title, from, to
   1   Type 'Promise<A2aMessageRecord | undefined>' is missing the following properties from type 'A2aMessageRecord': id, threadId, taskId, round, and 11 more.
   1   Property 'update' does not exist on type 'Promise<TaskService>'.
   1   Property 'reconcile' is missing in type 'Promise<AuditReconciler>' but required in type 'AuditReconciler'.
   1   Property 'create' does not exist on type 'Promise<TaskService>'.
   1   Property 'completionNotice' does not exist on type 'Promise<TaskService>'.
   1     Type '{ status: "duplicate" | "recorded"; id: string; taskId: string | null; }' is missing the following properties from type 'Promise<unknown>': then, catch, finally, [Symbol.toStringTag]
   1     Type 'Promise<Replyer>' is not assignable to type '
   1     Property 'embed' is missing in type 'Promise<EmbeddingClient>' but required in type 'EmbeddingClient'.
   1     'T' could be instantiated with an arbitrary type which could be unrelated to 'Promise<T>'.
   1       Type 'Promise<Replyer>' provides no match for the signature '
