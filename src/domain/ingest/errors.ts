export type IngestErrorCode = "BAD_REQUEST";

const ERROR_STATUS: Record<IngestErrorCode, number> = {
  BAD_REQUEST: 400,
};

export class IngestError extends Error {
  readonly status: number;

  constructor(
    readonly code: IngestErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "IngestError";
    this.status = ERROR_STATUS[code];
  }
}
