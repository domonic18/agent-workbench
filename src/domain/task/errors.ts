export type TaskErrorCode = "VALIDATION_FAILED" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT";

const ERROR_STATUS: Record<TaskErrorCode, number> = {
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
};

export class TaskError extends Error {
  readonly status: number;

  constructor(
    readonly code: TaskErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "TaskError";
    this.status = ERROR_STATUS[code];
  }
}
