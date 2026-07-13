export interface TypingTransition {
  readonly conversationId: string;
  readonly userId: string;
  readonly isTyping: boolean;
}

/** Injectable in place of the global setTimeout/clearTimeout so tests can use a fake
 * clock (docs/06-implementation-plan.md Phase 6 "Unit test for typing auto-expiry (fake
 * clock)") instead of waiting on real 6-second timers. */
type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface TypingScheduler {
  schedule(callback: () => void, delayMs: number): TimerHandle;
  cancel(handle: TimerHandle): void;
}

const realScheduler: TypingScheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle),
};

const DEFAULT_EXPIRY_MS = 6000;

/**
 * docs/03-websocket-events.md "Module: Typing Indicators" — in-memory only, no DB (a
 * typing indicator is inherently ephemeral). `onExpire` fires when a `typing.start`
 * isn't followed by `typing.stop` within `expiryMs`; the caller (transport layer) is
 * responsible for actually broadcasting that transition, since this service never
 * touches ConnectionManager or ProtocolCodec.
 */
export class TypingService {
  private readonly timers = new Map<string, TimerHandle>();

  constructor(
    private readonly onExpire: (transition: TypingTransition) => void,
    private readonly scheduler: TypingScheduler = realScheduler,
    private readonly expiryMs: number = DEFAULT_EXPIRY_MS,
  ) {}

  start(conversationId: string, userId: string): void {
    const key = TypingService.key(conversationId, userId);
    this.clearExisting(key);
    const handle = this.scheduler.schedule(() => {
      this.timers.delete(key);
      this.onExpire({ conversationId, userId, isTyping: false });
    }, this.expiryMs);
    this.timers.set(key, handle);
  }

  stop(conversationId: string, userId: string): void {
    this.clearExisting(TypingService.key(conversationId, userId));
  }

  private clearExisting(key: string): void {
    const handle = this.timers.get(key);
    if (handle !== undefined) {
      this.scheduler.cancel(handle);
      this.timers.delete(key);
    }
  }

  private static key(conversationId: string, userId: string): string {
    return `${conversationId}:${userId}`;
  }
}
