export type TokenUsageErrorCode = "VALIDATION_FAILED" | "NOT_FOUND" | "CONFLICT";

const ERROR_STATUS: Record<TokenUsageErrorCode, number> = {
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
};

export class TokenUsageError extends Error {
  readonly status: number;

  constructor(
    readonly code: TokenUsageErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "TokenUsageError";
    this.status = ERROR_STATUS[code];
  }
}
