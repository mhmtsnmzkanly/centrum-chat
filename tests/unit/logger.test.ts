import { assertEquals } from "jsr:@std/assert@1";
import { createLogger } from "../../src/shared/logging/logger.ts";

function captureConsole() {
  const originals = { log: console.log, warn: console.warn, error: console.error };
  const lines: { stream: "log" | "warn" | "error"; line: string }[] = [];
  console.log = (line: string) => lines.push({ stream: "log", line });
  console.warn = (line: string) => lines.push({ stream: "warn", line });
  console.error = (line: string) => lines.push({ stream: "error", line });
  return {
    lines,
    restore: () => {
      console.log = originals.log;
      console.warn = originals.warn;
      console.error = originals.error;
    },
  };
}

Deno.test("createLogger: suppresses levels below minLevel", () => {
  const capture = captureConsole();
  try {
    const logger = createLogger("warn", "test-module");
    logger.debug("should not appear");
    logger.info("should not appear either");
    logger.warn("this one shows up");
    logger.error("and this one too");

    assertEquals(capture.lines.length, 2);
    assertEquals(capture.lines[0]!.stream, "warn");
    assertEquals(capture.lines[1]!.stream, "error");
  } finally {
    capture.restore();
  }
});

Deno.test("createLogger: writes structured JSON with timestamp/level/module/message/context", () => {
  const capture = captureConsole();
  try {
    const logger = createLogger("info", "my-module");
    logger.info("something happened", { userId: "u-1" });

    assertEquals(capture.lines.length, 1);
    const parsed = JSON.parse(capture.lines[0]!.line);
    assertEquals(parsed.level, "info");
    assertEquals(parsed.module, "my-module");
    assertEquals(parsed.message, "something happened");
    assertEquals(parsed.userId, "u-1");
    assertEquals(typeof parsed.timestamp, "string");
  } finally {
    capture.restore();
  }
});

Deno.test("Logger.child: merges base context into every subsequent call, own context wins on key conflicts", () => {
  const capture = captureConsole();
  try {
    const logger = createLogger("info", "main");
    const child = logger.child("ws-connection", { connectionId: "c-1", userId: "u-1" });
    child.info("connected");
    child.warn("something", { userId: "override-u" }); // per-call context wins over child's base

    const first = JSON.parse(capture.lines[0]!.line);
    assertEquals(first.module, "ws-connection");
    assertEquals(first.connectionId, "c-1");
    assertEquals(first.userId, "u-1");

    const second = JSON.parse(capture.lines[1]!.line);
    assertEquals(second.userId, "override-u");
    assertEquals(second.connectionId, "c-1"); // still carried from the child's base context
  } finally {
    capture.restore();
  }
});

Deno.test("Logger.child: chaining child() again merges contexts from both levels", () => {
  const capture = captureConsole();
  try {
    const logger = createLogger("info", "main");
    const grandchild = logger.child("a", { x: 1 }).child("b", { y: 2 });
    grandchild.info("hi");

    const parsed = JSON.parse(capture.lines[0]!.line);
    assertEquals(parsed.module, "b");
    assertEquals(parsed.x, 1);
    assertEquals(parsed.y, 2);
  } finally {
    capture.restore();
  }
});

Deno.test("createLogger: error-level lines go to console.error, others to console.log", () => {
  const capture = captureConsole();
  try {
    const logger = createLogger("debug", "test-module");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    assertEquals(capture.lines.map((l) => l.stream), ["log", "log", "warn", "error"]);
  } finally {
    capture.restore();
  }
});

Deno.test("createLogger: centrally redacts sensitive fields without mutating caller-owned context", () => {
  const capture = captureConsole();
  try {
    const logger = createLogger("info", "redaction-test");
    const context = {
      password: "hunter2",
      Authorization: "Bearer abc",
      nested: {
        refresh_token: "refresh",
        tokenCount: 4,
      },
      array: [{ newPassword: "next" }],
    };

    logger.info("sensitive", context);

    const parsed = JSON.parse(capture.lines[0]!.line);
    assertEquals(parsed.password, "[REDACTED]");
    assertEquals(parsed.Authorization, "[REDACTED]");
    assertEquals(parsed.nested.refresh_token, "[REDACTED]");
    assertEquals(parsed.nested.tokenCount, 4);
    assertEquals(parsed.array[0].newPassword, "[REDACTED]");

    assertEquals(context.password, "hunter2");
    assertEquals(context.Authorization, "Bearer abc");
    assertEquals(context.nested.refresh_token, "refresh");
    assertEquals(context.array[0]!.newPassword, "next");
  } finally {
    capture.restore();
  }
});

Deno.test("createLogger: bounds recursion, handles circular structures, truncates long strings, and preserves useful error fields", () => {
  const capture = captureConsole();
  try {
    const logger = createLogger("info", "bounds-test");
    const circular: Record<string, unknown> = { secret: "top-secret" };
    circular.self = circular;
    const error = new Error("boom");
    Object.assign(error, { refreshToken: "refresh", details: { cookie: "cookie-value" } });

    logger.info("bounded", {
      circular,
      deep: { a: { b: { c: { d: { e: { f: "too-deep" } } } } } },
      long: "x".repeat(2_000),
      error,
    });

    const parsed = JSON.parse(capture.lines[0]!.line);
    assertEquals(parsed.circular.secret, "[REDACTED]");
    assertEquals(parsed.circular.self, "[CIRCULAR]");
    assertEquals(parsed.deep.a.b.c.d, "[MAX_DEPTH]");
    assertEquals(parsed.long.endsWith("[TRUNCATED]"), true);
    assertEquals(parsed.error.name, "Error");
    assertEquals(parsed.error.message, "boom");
    assertEquals(parsed.error.refreshToken, "[REDACTED]");
    assertEquals(parsed.error.details.cookie, "[REDACTED]");
  } finally {
    capture.restore();
  }
});
