export type WorkErrorCode = "VALIDATION_FAILED" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT";

const ERROR_STATUS: Record<WorkErrorCode, number> = {
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
};

/** work 域工具与任务关联校验的错误面;工具层经 failureResult 映射为模型可读文本 */
export class WorkError extends Error {
  readonly status: number;

  constructor(
    readonly code: WorkErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "WorkError";
    this.status = ERROR_STATUS[code];
  }
}
