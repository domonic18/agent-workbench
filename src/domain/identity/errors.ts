export type IdentityErrorCode = "VALIDATION_FAILED" | "NOT_FOUND" | "CONFLICT";

const ERROR_STATUS: Record<IdentityErrorCode, number> = {
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
};

export class IdentityError extends Error {
  readonly status: number;

  constructor(
    readonly code: IdentityErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "IdentityError";
    this.status = ERROR_STATUS[code];
  }
}
