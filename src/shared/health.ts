export type DatabaseStatus = "ok" | "unavailable";

export interface HealthPayload {
  status: "ok" | "degraded";
  version: string;
  db: DatabaseStatus;
  uptime: number;
}

export function healthPayload(
  version: string,
  startedAt: number,
  db: DatabaseStatus,
  now: number = Date.now(),
): HealthPayload {
  return {
    status: db === "ok" ? "ok" : "degraded",
    version,
    db,
    uptime: Math.max(0, Math.floor((now - startedAt) / 1000)),
  };
}
