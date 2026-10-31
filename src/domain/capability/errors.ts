export type CapabilityErrorCode = "VALIDATION_FAILED" | "NOT_FOUND" | "UPSTREAM_UNAVAILABLE";

const ERROR_STATUS: Record<CapabilityErrorCode, number> = {
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  UPSTREAM_UNAVAILABLE: 503,
};

export class CapabilityError extends Error {
  readonly status: number;

  constructor(
    readonly code: CapabilityErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "CapabilityError";
    this.status = ERROR_STATUS[code];
  }
}
