import type { RateLimiter } from "../../shared/rateLimit/rateLimiter.ts";
import { RateLimitedError } from "../../shared/errors/rateLimitedError.ts";

/** Throws `RATE_LIMITED` if the `(event, userId)` bucket is empty — the standard guard
 * every rate-limited WS handler calls first (architecture doc §5, "Token-bucket per
 * (userId, category)"). `event` is the category; handlers pass their own `this.event`
 * so the key never drifts out of sync with the event name. */
export function requireRateLimit(rateLimiter: RateLimiter, event: string, userId: string): void {
  if (!rateLimiter.check(`${event}:${userId}`)) {
    throw new RateLimitedError("You are doing that too quickly. Please slow down.");
  }
}
