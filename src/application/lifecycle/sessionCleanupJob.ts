import type { Logger } from "../../shared/logging/logger.ts";

export interface SessionCleanupTarget {
  cleanupExpiredAndRevoked(nowIso: string, revokedBeforeIso: string): number;
}

type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface CleanupScheduler {
  schedule(callback: () => void, delayMs: number): TimerHandle;
  cancel(handle: TimerHandle): void;
}

const realScheduler: CleanupScheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle),
};

export interface SessionCleanupJobOptions {
  readonly intervalMs: number;
  readonly revokedSessionRetentionMs: number;
  readonly scheduler?: CleanupScheduler;
  readonly now?: () => number;
}

/** Starts one immediate cleanup pass at boot and then keeps repeating it on a
 * configurable interval. The job never overlaps itself: the next run is scheduled only
 * after the current pass finishes, and failures are logged instead of thrown so boot and
 * shutdown remain stable. */
export class SessionCleanupJob {
  private readonly scheduler: CleanupScheduler;
  private readonly now: () => number;
  private timerHandle: TimerHandle | null = null;
  private started = false;
  private stopped = false;
  private running = false;

  constructor(
    private readonly authService: SessionCleanupTarget,
    private readonly logger: Logger,
    private readonly options: SessionCleanupJobOptions,
  ) {
    this.scheduler = options.scheduler ?? realScheduler;
    this.now = options.now ?? (() => Date.now());
    if (options.intervalMs <= 0) {
      throw new Error("SESSION_CLEANUP_INTERVAL_MS must be greater than zero.");
    }
    if (options.revokedSessionRetentionMs < 0) {
      throw new Error("REVOKED_SESSION_RETENTION_MS must be zero or greater.");
    }
  }

  runOnce(): number {
    if (this.stopped) return 0;
    return this.executeCleanup();
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timerHandle !== null) {
      this.scheduler.cancel(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private scheduleNext(): void {
    if (this.stopped || this.timerHandle !== null) return;
    this.timerHandle = this.scheduler.schedule(() => {
      this.timerHandle = null;
      this.runScheduledPass();
    }, this.options.intervalMs);
  }

  private runScheduledPass(): void {
    if (this.stopped) return;
    if (this.running) {
      this.logger.warn("session cleanup run skipped because another pass is still running");
      this.scheduleNext();
      return;
    }

    this.executeCleanup();
    if (!this.stopped) {
      this.scheduleNext();
    }
  }

  private executeCleanup(): number {
    if (this.running) {
      this.logger.warn("session cleanup run skipped because another pass is still running");
      return 0;
    }

    this.running = true;
    try {
      const nowMs = this.now();
      const nowIso = new Date(nowMs).toISOString();
      const revokedBeforeIso = new Date(nowMs - this.options.revokedSessionRetentionMs)
        .toISOString();
      return this.authService.cleanupExpiredAndRevoked(nowIso, revokedBeforeIso);
    } catch (error) {
      this.logger.error("session cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    } finally {
      this.running = false;
    }
  }
}
