import { api } from "./client.js";
import type { ScheduleRow } from "./types.js";

interface ScheduleListResponse {
  items: ScheduleRow[];
}

/** 定时任务清单:执行机上报的计划快照,只读 */
export function fetchSchedules(): Promise<ScheduleRow[]> {
  return api
    .get<ScheduleListResponse>("/api/schedules")
    .then((response) => response.items);
}
