export type A2aErrorCode = "VALIDATION_FAILED" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT";

const ERROR_STATUS: Record<A2aErrorCode, number> = {
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
};

export class A2aError extends Error {
  readonly status: number;

  constructor(
    readonly code: A2aErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "A2aError";
    this.status = ERROR_STATUS[code];
  }
}
