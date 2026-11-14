import type { FastifyInstance } from "fastify";
import { listScheduleRows, type ScheduleRow } from "../../domain/schedule/service.js";
import type { Db } from "../../store/database.js";
import { requireSession } from "../middleware/session.js";

export interface ScheduleRoutesOptions {
  db: Db;
  now?: () => number;
}

/**
 * 定时任务只读路由。
 *
 * 只有 GET:计划由 cc-connect 侧维护,控制台不改频率、不停用、不手动触发——
 * 两个真相源必然打架,这里只做观测。
 */
export function registerScheduleRoutes(app: FastifyInstance, options: ScheduleRoutesOptions): void {
  const now = options.now ?? Date.now;
  const session = requireSession(options.db, now);

  app.get("/api/schedules", { preHandler: session }, async () => {
    const rows: ScheduleRow[] = await listScheduleRows(options.db, now());
    return { items: rows };
  });
}
