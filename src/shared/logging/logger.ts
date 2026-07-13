export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";
const MAX_DEPTH = "[MAX_DEPTH]";
const MAX_NODES = "[MAX_NODES]";
const CIRCULAR = "[CIRCULAR]";
const INVALID_DATE = "[INVALID_DATE]";
const FUNCTION_VALUE = "[FUNCTION]";
const MAX_LOG_DEPTH = 5;
const MAX_LOG_NODES = 200;
const MAX_LOG_PROPERTIES = 200;
const MAX_LOG_PROPERTIES_PER_OBJECT = 50;
const MAX_LOG_ARRAY_ELEMENTS = 50;
const MAX_LOG_STRING_LENGTH = 1_024;
const SENSITIVE_KEYS = new Set([
  "password",
  "currentpassword",
  "newpassword",
  "accesstoken",
  "refreshtoken",
  "refreshtokenhash",
  "authorization",
  "cookie",
  "verificationtoken",
  "resettoken",
  "tokenhash",
  "jwtsecret",
  "secret",
]);

export interface LogContext {
  readonly [key: string]: unknown;
}

export interface LoggerOptions {
  readonly includeErrorStacks?: boolean;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Returns a child logger that merges `context` into every call's context. */
  child(module: string, context?: LogContext): Logger;
}

class ConsoleLogger implements Logger {
  constructor(
    private readonly minLevel: LogLevel,
    private readonly module: string,
    private readonly baseContext: LogContext = {},
    private readonly options: Required<LoggerOptions> = { includeErrorStacks: true },
  ) {}

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) return;
    const sanitizedContext = sanitizeContext({ ...this.baseContext, ...context }, this.options);
    const line = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message: sanitizeForLog(message, this.options),
      ...sanitizedContext,
    };
    const out = JSON.stringify(line);
    if (level === "error") console.error(out);
    else if (level === "warn") console.warn(out);
    else console.log(out);
  }

  debug(message: string, context?: LogContext): void {
    this.write("debug", message, context);
  }
  info(message: string, context?: LogContext): void {
    this.write("info", message, context);
  }
  warn(message: string, context?: LogContext): void {
    this.write("warn", message, context);
  }
  error(message: string, context?: LogContext): void {
    this.write("error", message, context);
  }

  child(module: string, context?: LogContext): Logger {
    return new ConsoleLogger(
      this.minLevel,
      module,
      { ...this.baseContext, ...context },
      this.options,
    );
  }
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

function truncateString(value: string): string {
  if (value.length <= MAX_LOG_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_LOG_STRING_LENGTH)}${TRUNCATED}`;
}

interface RedactionState {
  nodesVisited: number;
  propertiesVisited: number;
  readonly seen: WeakSet<object>;
  readonly includeErrorStacks: boolean;
}

function sanitizeContext(context: LogContext, options: LoggerOptions): Record<string, unknown> {
  const sanitized = sanitizeForLog(context, options);
  if (
    typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)
  ) {
    return sanitized as Record<string, unknown>;
  }
  return { context: sanitized };
}

function sanitizeError(
  error: Error,
  depth: number,
  state: RedactionState,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {
    name: truncateString(error.name || "Error"),
    message: truncateString(error.message),
  };
  if (state.includeErrorStacks && typeof error.stack === "string") {
    sanitized.stack = truncateString(error.stack);
  }

  for (const [key, value] of Object.entries(error)) {
    if (key === "name" || key === "message" || key === "stack") continue;
    if (state.propertiesVisited >= MAX_LOG_PROPERTIES) {
      sanitized.__truncated__ = TRUNCATED;
      break;
    }
    state.propertiesVisited += 1;
    sanitized[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(value, depth + 1, state);
  }
  return sanitized;
}

function sanitizeArray(value: unknown[], depth: number, state: RedactionState): unknown[] {
  const sanitized: unknown[] = [];
  const limit = Math.min(value.length, MAX_LOG_ARRAY_ELEMENTS);
  for (let i = 0; i < limit; i += 1) {
    sanitized.push(sanitizeValue(value[i], depth + 1, state));
  }
  if (value.length > MAX_LOG_ARRAY_ELEMENTS) sanitized.push(TRUNCATED);
  return sanitized;
}

function sanitizeObject(
  value: Record<string, unknown>,
  depth: number,
  state: RedactionState,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  let perObjectProperties = 0;
  for (const [key, child] of Object.entries(value)) {
    if (
      perObjectProperties >= MAX_LOG_PROPERTIES_PER_OBJECT ||
      state.propertiesVisited >= MAX_LOG_PROPERTIES
    ) {
      sanitized.__truncated__ = TRUNCATED;
      break;
    }
    perObjectProperties += 1;
    state.propertiesVisited += 1;
    sanitized[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(child, depth + 1, state);
  }
  return sanitized;
}

function sanitizeValue(value: unknown, depth: number, state: RedactionState): unknown {
  if (typeof value === "string") return truncateString(value);
  if (
    typeof value === "number" || typeof value === "boolean" || value === null ||
    value === undefined
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return String(value);
  if (typeof value === "function") return FUNCTION_VALUE;
  if (depth >= MAX_LOG_DEPTH) return MAX_DEPTH;
  if (typeof value !== "object") return String(value);
  if (state.nodesVisited >= MAX_LOG_NODES) return MAX_NODES;
  if (state.seen.has(value)) return CIRCULAR;

  state.nodesVisited += 1;
  state.seen.add(value);
  try {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? INVALID_DATE : value.toISOString();
    }
    if (value instanceof Error) return sanitizeError(value, depth, state);
    if (Array.isArray(value)) return sanitizeArray(value, depth, state);
    return sanitizeObject(value as Record<string, unknown>, depth, state);
  } finally {
    state.seen.delete(value);
  }
}

export function sanitizeForLog(value: unknown, options: LoggerOptions = {}): unknown {
  return sanitizeValue(value, 0, {
    nodesVisited: 0,
    propertiesVisited: 0,
    seen: new WeakSet<object>(),
    includeErrorStacks: options.includeErrorStacks ?? true,
  });
}

/**
 * The one place JSON.stringify is used outside the protocol codec: this formats
 * structured log lines for stdout/stderr, not wire-protocol messages, so it is
 * exempt from the ProtocolCodec boundary described in the architecture doc.
 */
export function createLogger(
  minLevel: LogLevel,
  module: string,
  options: LoggerOptions = {},
): Logger {
  return new ConsoleLogger(minLevel, module, {}, {
    includeErrorStacks: options.includeErrorStacks ?? true,
  });
}
