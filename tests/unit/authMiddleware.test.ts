import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  extractBearerToken,
  verifyAccessToken,
} from "../../src/application/middleware/authMiddleware.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { UnauthorizedError } from "../../src/shared/errors/unauthorizedError.ts";

Deno.test("extractBearerToken: extracts the token from a well-formed header", () => {
  assertEquals(extractBearerToken("Bearer abc123"), "abc123");
});

Deno.test("extractBearerToken: returns null for a missing header", () => {
  assertEquals(extractBearerToken(null), null);
});

Deno.test("extractBearerToken: returns null for headers without the Bearer scheme", () => {
  assertEquals(extractBearerToken("abc123"), null);
  assertEquals(extractBearerToken("Basic dXNlcjpwYXNz"), null);
  assertEquals(extractBearerToken(""), null);
});

Deno.test('extractBearerToken: is case-sensitive on the scheme ("Bearer", not "bearer")', () => {
  // The RFC 6750 scheme name is case-sensitive; matching the frontend/client contract
  // this server actually issues ("Bearer <token>"), not a looser accept-anything match.
  assertEquals(extractBearerToken("bearer abc123"), null);
});

Deno.test("extractBearerToken: requires at least one space between scheme and token", () => {
  assertEquals(extractBearerToken("Bearer"), null);
  assertEquals(extractBearerToken("Bearer "), null);
});

Deno.test("verifyAccessToken: resolves the userId for a valid token", async () => {
  const tokenService = new TokenService({ secret: "test-secret", accessTokenTtlSeconds: 900 });
  const token = await tokenService.signAccessToken("user-123", "alice", "session-123");

  const auth = await verifyAccessToken(tokenService, token);
  assertEquals(auth.userId, "user-123");
  assertEquals(auth.sessionId, "session-123");
});

Deno.test("verifyAccessToken: throws UnauthorizedError for a null token", async () => {
  const tokenService = new TokenService({ secret: "test-secret", accessTokenTtlSeconds: 900 });
  await assertRejects(
    () => verifyAccessToken(tokenService, null),
    UnauthorizedError,
  );
});

Deno.test("verifyAccessToken: throws UnauthorizedError for garbage input", async () => {
  const tokenService = new TokenService({ secret: "test-secret", accessTokenTtlSeconds: 900 });
  await assertRejects(
    () => verifyAccessToken(tokenService, "not-a-real-token"),
    UnauthorizedError,
  );
});

Deno.test("verifyAccessToken: throws UnauthorizedError for a token signed with a different secret", async () => {
  const signer = new TokenService({ secret: "secret-a", accessTokenTtlSeconds: 900 });
  const verifier = new TokenService({ secret: "secret-b", accessTokenTtlSeconds: 900 });
  const token = await signer.signAccessToken("user-123", "alice", "session-123");

  await assertRejects(
    () => verifyAccessToken(verifier, token),
    UnauthorizedError,
  );
});

Deno.test("verifyAccessToken: throws UnauthorizedError for an expired token", async () => {
  const tokenService = new TokenService({ secret: "test-secret", accessTokenTtlSeconds: -1 });
  const alreadyExpiredToken = await tokenService.signAccessToken(
    "user-123",
    "alice",
    "session-123",
  );

  await assertRejects(
    () => verifyAccessToken(tokenService, alreadyExpiredToken),
    UnauthorizedError,
  );
});
