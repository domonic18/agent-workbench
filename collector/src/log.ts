export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  lastError(): string | null;
}

export interface LoggerOptions {
  level?: LogLevel;
  sink?: (line: string) => void;
  now?: () => number;
}

/** 只记事件与计数,调用方不得把密钥、消息正文塞进 fields */
export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const sink = options.sink ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = options.now ?? Date.now;
  let lastError: string | null = null;

  function write(at: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (ORDER[at] < ORDER[level]) {
      return;
    }
    const line = JSON.stringify({
      at: new Date(now()).toISOString(),
      level: at,
      message,
      ...(fields ?? {}),
    });
    sink(line);
    if (at === "error") {
      lastError = `${new Date(now()).toISOString()} ${message}`;
    }
  }

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    lastError: () => lastError,
  };
}
