import { assertEquals } from "jsr:@std/assert@1";
import {
  type TypingScheduler,
  TypingService,
  type TypingTransition,
} from "../../src/domain/typing/typingService.ts";

/** Fake clock: captures scheduled callbacks instead of using real timers, and lets the
 * test fire them on demand — this is what makes typing auto-expiry testable without
 * waiting on a real 6-second timeout (docs/06-implementation-plan.md Phase 6). */
class FakeScheduler implements TypingScheduler {
  private nextHandle = 1;
  private readonly pending = new Map<number, () => void>();

  schedule(callback: () => void, _delayMs: number): number {
    const handle = this.nextHandle++;
    this.pending.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.pending.delete(handle);
  }

  fireAll(): void {
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) callback();
  }

  pendingCount(): number {
    return this.pending.size;
  }
}

function makeService() {
  const scheduler = new FakeScheduler();
  const expirations: TypingTransition[] = [];
  const service = new TypingService((transition) => expirations.push(transition), scheduler, 6000);
  return { service, scheduler, expirations };
}

Deno.test("TypingService.start schedules an expiry that fires isTyping:false if never stopped", () => {
  const { service, scheduler, expirations } = makeService();
  service.start("room-1", "user-1");
  assertEquals(expirations.length, 0);

  scheduler.fireAll();
  assertEquals(expirations, [{ conversationId: "room-1", userId: "user-1", isTyping: false }]);
});

Deno.test("TypingService.stop cancels the pending expiry before it fires", () => {
  const { service, scheduler, expirations } = makeService();
  service.start("room-1", "user-1");
  service.stop("room-1", "user-1");

  scheduler.fireAll();
  assertEquals(expirations.length, 0);
  assertEquals(scheduler.pendingCount(), 0);
});

Deno.test("TypingService.start called again resets the timer instead of stacking two expirations", () => {
  const { service, scheduler, expirations } = makeService();
  service.start("room-1", "user-1");
  service.start("room-1", "user-1"); // e.g. the user kept typing

  assertEquals(scheduler.pendingCount(), 1); // old timer was cancelled, not left running
  scheduler.fireAll();
  assertEquals(expirations.length, 1);
});

Deno.test("TypingService tracks each (conversationId, userId) pair independently", () => {
  const { service, scheduler, expirations } = makeService();
  service.start("room-1", "user-1");
  service.start("room-1", "user-2");
  service.start("room-2", "user-1");

  assertEquals(scheduler.pendingCount(), 3);
  service.stop("room-1", "user-1");
  assertEquals(scheduler.pendingCount(), 2);

  scheduler.fireAll();
  assertEquals(expirations.length, 2);
  assertEquals(
    expirations.map((t) => `${t.conversationId}:${t.userId}`).sort(),
    ["room-1:user-2", "room-2:user-1"],
  );
});
