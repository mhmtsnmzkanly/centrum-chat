import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import type {
  CleanupScheduler,
  SessionCleanupTarget,
} from "../../src/application/lifecycle/sessionCleanupJob.ts";
import { SessionCleanupJob } from "../../src/application/lifecycle/sessionCleanupJob.ts";
import type { Logger } from "../../src/shared/logging/logger.ts";

class FakeScheduler implements CleanupScheduler {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, () => void>();

  schedule(callback: () => void, _delayMs: number): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle);
  }

  fireNext(): boolean {
    const entry = this.callbacks.entries().next().value as [number, () => void] | undefined;
    if (!entry) return false;
    const [handle, callback] = entry;
    this.callbacks.delete(handle);
    callback();
    return true;
  }

  pendingCount(): number {
    return this.callbacks.size;
  }
}

class RecordingLogger implements Logger {
  readonly errors: Array<{ message: string; context: Record<string, unknown> | undefined }> = [];
  readonly warns: Array<{ message: string; context: Record<string, unknown> | undefined }> = [];

  debug(_message: string, _context?: Record<string, unknown>): void {}
  info(_message: string, _context?: Record<string, unknown>): void {}
  warn(message: string, context?: Record<string, unknown>): void {
    this.warns.push({ message, context });
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.errors.push({ message, context });
  }
  child(_module: string, _context?: Record<string, unknown>): Logger {
    return this;
  }
}

class FakeCleanupTarget implements SessionCleanupTarget {
  readonly calls: Array<{ nowIso: string; revokedBeforeIso: string }> = [];
  private remainingFailures = 0;

  constructor(private readonly result = 1) {}

  failNextCall(times = 1): void {
    this.remainingFailures = times;
  }

  cleanupExpiredAndRevoked(nowIso: string, revokedBeforeIso: string): number {
    this.calls.push({ nowIso, revokedBeforeIso });
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new Error("cleanup failed");
    }
    return this.result;
  }
}

function makeJob(
  options: Partial<{ intervalMs: number; retentionMs: number; now: () => number }> = {},
) {
  const scheduler = new FakeScheduler();
  const logger = new RecordingLogger();
  const target = new FakeCleanupTarget();
  const now = options.now ?? (() => Date.UTC(2026, 0, 1, 12, 0, 0));
  const job = new SessionCleanupJob(target, logger, {
    intervalMs: options.intervalMs ?? 1000,
    revokedSessionRetentionMs: options.retentionMs ?? 2000,
    scheduler,
    now,
  });
  return { job, scheduler, logger, target, now };
}

Deno.test("SessionCleanupJob.runOnce calls cleanup with the expected timestamps", () => {
  const { job, target } = makeJob();
  const removed = job.runOnce();
  assertEquals(removed, 1);
  assertEquals(target.calls.length, 1);
  assertEquals(target.calls[0]!.nowIso, "2026-01-01T12:00:00.000Z");
  assertEquals(target.calls[0]!.revokedBeforeIso, "2026-01-01T11:59:58.000Z");
});

Deno.test("SessionCleanupJob.start schedules one repeating timer and ignores duplicate start calls", () => {
  const { job, scheduler, target } = makeJob();
  job.start();
  job.start();
  assertEquals(scheduler.pendingCount(), 1);

  const fired = scheduler.fireNext();
  assertEquals(fired, true);
  assertEquals(target.calls.length, 1);
  assertEquals(scheduler.pendingCount(), 1);
});

Deno.test("SessionCleanupJob keeps scheduling after a failed run", () => {
  const { job, scheduler, logger, target } = makeJob();
  target.failNextCall();
  job.start();

  assertEquals(scheduler.fireNext(), true);
  assertEquals(target.calls.length, 1);
  assertEquals(logger.errors.length, 1);
  assertEquals(scheduler.pendingCount(), 1);

  assertEquals(scheduler.fireNext(), true);
  assertEquals(target.calls.length, 2);
  assertEquals(scheduler.pendingCount(), 1);
});

Deno.test("SessionCleanupJob.stop cancels future runs", () => {
  const { job, scheduler } = makeJob();
  job.start();
  assertEquals(scheduler.pendingCount(), 1);

  job.stop();
  assertEquals(scheduler.pendingCount(), 0);
  assertEquals(scheduler.fireNext(), false);
});

Deno.test("SessionCleanupJob rejects nonsensical configuration", () => {
  const { logger, target } = makeJob();
  assertThrows(
    () =>
      new SessionCleanupJob(target, logger, {
        intervalMs: 0,
        revokedSessionRetentionMs: 1,
      }),
    Error,
  );
  assertThrows(
    () =>
      new SessionCleanupJob(target, logger, {
        intervalMs: 1,
        revokedSessionRetentionMs: -1,
      }),
    Error,
  );
});
