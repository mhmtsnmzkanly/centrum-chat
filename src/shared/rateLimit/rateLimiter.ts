export interface RateLimiterOptions {
  readonly maxTokens: number;
  readonly refillIntervalMs: number;
  /** Hard cap on the number of distinct keys tracked at once. Keys are attacker-influenced
   * (per-IP, per-connection, per-user), so an unbounded map is a memory-exhaustion vector.
   * When the cap is reached, fully-refilled (idle) buckets are dropped first, then the
   * least-recently-touched buckets are evicted. Defaults to 100_000. */
  readonly maxKeys?: number;
}

interface Bucket {
  tokens: number;
  lastRefillAt: number;
}

const DEFAULT_MAX_KEYS = 100_000;

/** Token-bucket per key, in-memory (architecture doc §5). Injected as a port so
 * handlers call `check(key, cost)` and the caller turns a limit breach into the
 * standard `RATE_LIMITED` error envelope — never a raw exception, never a dropped
 * connection. Keys are caller-composed, e.g. `message.send:${userId}`. */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxKeys: number;

  constructor(private readonly options: RateLimiterOptions) {
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  }

  /** Returns true if `cost` tokens were available and have been consumed. */
  check(key: string, cost = 1): boolean {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (existing === undefined && this.buckets.size >= this.maxKeys) {
      this.evict(now);
    }
    const bucket = existing ?? { tokens: this.options.maxTokens, lastRefillAt: now };

    const refillRate = this.options.maxTokens / this.options.refillIntervalMs;
    const elapsed = now - bucket.lastRefillAt;
    const tokens = Math.min(this.options.maxTokens, bucket.tokens + elapsed * refillRate);

    if (tokens < cost) {
      this.buckets.set(key, { tokens, lastRefillAt: now });
      return false;
    }
    this.buckets.set(key, { tokens: tokens - cost, lastRefillAt: now });
    return true;
  }

  /** Test/introspection hook: number of buckets currently held in memory. */
  trackedKeyCount(): number {
    return this.buckets.size;
  }

  /** Reclaims capacity when the key cap is hit. First drops buckets that have fully
   * refilled to `maxTokens` (idle callers no longer being limited — safe to forget). If
   * that isn't enough, evicts the least-recently-touched buckets until back under cap. */
  private evict(now: number): void {
    const refillRate = this.options.maxTokens / this.options.refillIntervalMs;
    for (const [key, bucket] of this.buckets) {
      const tokens = Math.min(
        this.options.maxTokens,
        bucket.tokens + (now - bucket.lastRefillAt) * refillRate,
      );
      if (tokens >= this.options.maxTokens) this.buckets.delete(key);
    }
    if (this.buckets.size < this.maxKeys) return;

    const byAge = [...this.buckets.entries()].sort((a, b) => a[1].lastRefillAt - b[1].lastRefillAt);
    const target = Math.floor(this.maxKeys / 2);
    for (const [key] of byAge) {
      if (this.buckets.size <= target) break;
      this.buckets.delete(key);
    }
  }
}
