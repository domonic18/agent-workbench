export interface HealthPayload {
  status: "ok";
  version: string;
  uptime: number;
}

export function healthPayload(
  version: string,
  startedAt: number,
  now: number = Date.now(),
): HealthPayload {
  return {
    status: "ok",
    version,
    uptime: Math.max(0, Math.floor((now - startedAt) / 1000)),
  };
}
