import type { RateLimiter } from "../../shared/rateLimit/rateLimiter.ts";
import { RateLimitedError } from "../../shared/errors/rateLimitedError.ts";

export function requireHttpRateLimit(
  rateLimiter: RateLimiter,
  key: string,
  message: string,
): void {
  if (!rateLimiter.check(key)) {
    throw new RateLimitedError(message);
  }
}
