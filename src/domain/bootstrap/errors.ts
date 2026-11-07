export type BootstrapErrorCode = "VALIDATION_FAILED" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN";

const ERROR_STATUS: Record<BootstrapErrorCode, number> = {
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
};

export class BootstrapError extends Error {
  readonly status: number;

  constructor(
    readonly code: BootstrapErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "BootstrapError";
    this.status = ERROR_STATUS[code];
  }
}
