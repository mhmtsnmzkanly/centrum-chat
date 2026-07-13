import { assertEquals } from "jsr:@std/assert@1";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";

Deno.test("RateLimiter: allows up to maxTokens requests, then denies", () => {
  const limiter = new RateLimiter({ maxTokens: 3, refillIntervalMs: 10_000 });
  assertEquals(limiter.check("k"), true);
  assertEquals(limiter.check("k"), true);
  assertEquals(limiter.check("k"), true);
  assertEquals(limiter.check("k"), false);
});

Deno.test("RateLimiter: different keys have independent buckets", () => {
  const limiter = new RateLimiter({ maxTokens: 1, refillIntervalMs: 10_000 });
  assertEquals(limiter.check("a"), true);
  assertEquals(limiter.check("a"), false);
  assertEquals(limiter.check("b"), true); // unaffected by "a"'s bucket being empty
});

Deno.test("RateLimiter: tracked keys are bounded by maxKeys (no unbounded growth)", () => {
  const limiter = new RateLimiter({ maxTokens: 1, refillIntervalMs: 10_000, maxKeys: 100 });
  // Drain the single token for each distinct attacker-chosen key so none look idle at
  // eviction time; this forces the age-based reclaim path and proves memory stays bounded.
  for (let i = 0; i < 10_000; i++) {
    limiter.check(`ip-${i}`);
  }
  assertEquals(limiter.trackedKeyCount() <= 100, true);
});

Deno.test("RateLimiter: tokens refill over time", async () => {
  const limiter = new RateLimiter({ maxTokens: 1, refillIntervalMs: 50 });
  assertEquals(limiter.check("k"), true);
  assertEquals(limiter.check("k"), false);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assertEquals(limiter.check("k"), true);
});
