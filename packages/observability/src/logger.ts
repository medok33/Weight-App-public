export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  traceId?: string;
  [key: string]: unknown;
}

const SECRET_KEY = /(password|secret|token|api[-_]?key|authorization|cookie)/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, SECRET_KEY.test(key) ? "[REDACTED]" : redact(entry)]),
  );
}

export function createLogger(service: string, write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)) {
  return (level: LogLevel, message: string, context: LogContext = {}): void => {
    const safeContext = redact(context) as Record<string, unknown>;
    write(JSON.stringify({ timestamp: new Date().toISOString(), level, service, message, ...safeContext }));
  };
}
