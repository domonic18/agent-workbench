import { api } from "./client.js";
import type { OverviewSnapshot } from "./types.js";

export function fetchOverview(): Promise<OverviewSnapshot> {
  return api.get("/api/overview");
}
