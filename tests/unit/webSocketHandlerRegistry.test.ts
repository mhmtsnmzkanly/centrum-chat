import { assertEquals } from "jsr:@std/assert@1";
import { WebSocketHandlerRegistry } from "../../src/application/websocket/registry.ts";
import type { EventHandler, HandlerContext } from "../../src/application/websocket/eventHandler.ts";
import type { InboundEnvelope } from "../../src/protocol/envelopes.ts";
import type { LogContext, Logger } from "../../src/shared/logging/logger.ts";
import { ValidationError } from "../../src/shared/errors/validationError.ts";

interface RecordedCall {
  readonly level: string;
  readonly message: string;
  readonly context: LogContext;
}

/** Captures every call, including calls made through a `.child()`-derived logger — a
 * real ConsoleLogger's child still writes to the same console, so this shares one
 * `calls` array by reference the same way, letting tests inspect calls made deep inside
 * code that only ever sees the child instance. */
class FakeLogger implements Logger {
  constructor(
    private readonly baseContext: LogContext = {},
    readonly calls: RecordedCall[] = [],
  ) {}

  private record(level: string, message: string, context?: LogContext): void {
    this.calls.push({ level, message, context: { ...this.baseContext, ...context } });
  }

  debug(message: string, context?: LogContext): void {
    this.record("debug", message, context);
  }
  info(message: string, context?: LogContext): void {
    this.record("info", message, context);
  }
  warn(message: string, context?: LogContext): void {
    this.record("warn", message, context);
  }
  error(message: string, context?: LogContext): void {
    this.record("error", message, context);
  }
  child(_module: string, context?: LogContext): Logger {
    return new FakeLogger({ ...this.baseContext, ...context }, this.calls);
  }
}

const ctx: HandlerContext = { userId: "u-1", connectionId: "c-1" };

function envelope(event: string, data: unknown = {}): InboundEnvelope {
  return { id: "req-1", event, data };
}

Deno.test("WebSocketHandlerRegistry.dispatch returns NOT_FOUND for an unregistered event", async () => {
  const registry = new WebSocketHandlerRegistry();
  const logger = new FakeLogger();
  const response = await registry.dispatch(ctx, envelope("no.such.event"), logger);
  assertEquals(response.success, false);
  assertEquals(response.error!.code, "NOT_FOUND");
});

Deno.test("WebSocketHandlerRegistry.dispatch returns the handler's data on success", async () => {
  const registry = new WebSocketHandlerRegistry();
  const handler: EventHandler = { event: "ping", handle: () => ({ pong: true }) };
  registry.register(handler);

  const response = await registry.dispatch(ctx, envelope("ping"), new FakeLogger());
  assertEquals(response.success, true);
  assertEquals(response.data, { pong: true });
});

Deno.test("WebSocketHandlerRegistry.dispatch logs an unexpected error enriched with event + requestId", async () => {
  const registry = new WebSocketHandlerRegistry();
  const handler: EventHandler = {
    event: "boom",
    handle: () => {
      throw new Error("something broke");
    },
  };
  registry.register(handler);

  const logger = new FakeLogger({ connectionId: "c-1", userId: "u-1" });
  const response = await registry.dispatch(ctx, envelope("boom"), logger);

  assertEquals(response.success, false);
  assertEquals(response.error!.code, "INTERNAL_ERROR");

  const errorCalls = logger.calls.filter((call) => call.level === "error");
  assertEquals(errorCalls.length, 1);
  assertEquals(errorCalls[0]!.context.connectionId, "c-1");
  assertEquals(errorCalls[0]!.context.userId, "u-1");
  assertEquals(errorCalls[0]!.context.event, "boom");
  assertEquals(errorCalls[0]!.context.requestId, "req-1");
});

Deno.test("WebSocketHandlerRegistry.dispatch does not log an expected DomainError", async () => {
  const registry = new WebSocketHandlerRegistry();
  const handler: EventHandler = {
    event: "validate.me",
    handle: () => {
      throw new ValidationError("bad input");
    },
  };
  registry.register(handler);

  const logger = new FakeLogger();
  const response = await registry.dispatch(ctx, envelope("validate.me"), logger);

  assertEquals(response.success, false);
  assertEquals(response.error!.code, "VALIDATION_ERROR");
  assertEquals(logger.calls.length, 0); // expected failures aren't logged (architecture doc §7)
});
