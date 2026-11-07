import type { FastifyInstance } from "fastify";
import { createOverviewService, type OverviewService } from "../../domain/overview/service.js";
import type { Db } from "../../store/database.js";
import { requireSession } from "../middleware/session.js";

export interface OverviewRoutesOptions {
  db: Db;
  now?: () => number;
  service?: OverviewService;
}

export function registerOverviewRoutes(app: FastifyInstance, options: OverviewRoutesOptions): void {
  const db = options.db;
  const now = options.now ?? Date.now;
  const service = options.service ?? createOverviewService({ db, now });
  const session = requireSession(db, now);

  app.get("/api/overview", { preHandler: session }, async () => service.get());
}
