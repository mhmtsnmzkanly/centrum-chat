import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteUserSessionRepository } from "../../src/storage/repositories/sqliteUserSessionRepository.ts";
import { SqliteEmailVerificationTokenRepository } from "../../src/storage/repositories/sqliteEmailVerificationTokenRepository.ts";
import { SqlitePasswordResetTokenRepository } from "../../src/storage/repositories/sqlitePasswordResetTokenRepository.ts";
import { SqliteEmailChangeTokenRepository } from "../../src/storage/repositories/sqliteEmailChangeTokenRepository.ts";
import { SqliteTransactionManager } from "../../src/storage/db.ts";
import { AuthService } from "../../src/domain/auth/authService.ts";
import { WebCryptoPasswordHasher } from "../../src/domain/auth/webCryptoPasswordHasher.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { FakeMailService } from "../support/fakeMailService.ts";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { RegisterRoute } from "../../src/application/http/routes/auth/registerRoute.ts";
import { LoginRoute } from "../../src/application/http/routes/auth/loginRoute.ts";
import { PasswordResetRequestRoute } from "../../src/application/http/routes/auth/passwordResetRequestRoute.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";
import type {
  CaptchaContext,
  CaptchaVerifier,
} from "../../src/domain/safety/captchaVerifier.port.ts";
import { CaptchaRequiredError } from "../../src/domain/safety/safetyErrors.ts";

class RecordingCaptcha implements CaptchaVerifier {
  readonly contexts: CaptchaContext[] = [];
  constructor(private readonly accepted: boolean) {}
  verify(_token: string | null, context: CaptchaContext): Promise<boolean> {
    this.contexts.push(context);
    return Promise.resolve(this.accepted);
  }
}

async function setup() {
  const database = await createTestDb();
  const users = new SqliteUserRepository(database.db);
  const resetTokens = new SqlitePasswordResetTokenRepository(database.db);
  const auth = new AuthService({
    users,
    userSessions: new SqliteUserSessionRepository(database.db),
    emailVerificationTokens: new SqliteEmailVerificationTokenRepository(database.db),
    passwordResetTokens: resetTokens,
    emailChangeTokens: new SqliteEmailChangeTokenRepository(database.db),
    passwordHasher: new WebCryptoPasswordHasher(),
    tokenService: new TokenService({ secret: "captcha-test-secret", accessTokenTtlSeconds: 900 }),
    transactions: new SqliteTransactionManager(database.db),
    mailService: new FakeMailService(),
    logger: createLogger("error", "captcha-routes-test"),
    sessionDefaultTtlMs: 86_400_000,
    sessionRememberedTtlMs: 2_592_000_000,
    emailVerificationTtlMs: 3_600_000,
    passwordResetTtlMs: 1_800_000,
    emailChangeTtlMs: 3_600_000,
    publicBaseUrl: "https://chat.example.com",
  });
  return { ...database, auth, users, resetTokens };
}

Deno.test("registration and login fail closed when CAPTCHA is missing, using actual peer IP", async () => {
  const h = await setup();
  try {
    const captcha = new RecordingCaptcha(false);
    const codec = new JsonCodec();
    const register = new RegisterRoute(h.auth, codec, undefined, captcha);
    await assertRejects(
      () =>
        register.handle({
          request: new Request("http://chat.test/api/auth/register", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-forwarded-for": "198.51.100.99",
            },
            body: JSON.stringify({
              username: "alice",
              email: "alice@example.com",
              password: "correct-horse-battery",
              displayName: "Alice",
            }),
          }),
          params: {},
          clientIp: "203.0.113.10",
        }),
      CaptchaRequiredError,
    );
    assertEquals(captcha.contexts[0]?.clientIp, "203.0.113.10");
    assertEquals(h.users.findByEmail("alice@example.com"), null);

    await h.auth.register({
      username: "alice",
      email: "alice@example.com",
      password: "correct-horse-battery",
      displayName: "Alice",
    });
    const login = new LoginRoute(
      h.auth,
      new RateLimiter({ maxTokens: 10, refillIntervalMs: 60_000 }),
      codec,
      captcha,
    );
    await assertRejects(
      () =>
        login.handle({
          request: new Request("http://chat.test/api/auth/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: "alice@example.com",
              password: "correct-horse-battery",
              role: "admin",
            }),
          }),
          params: {},
          clientIp: "203.0.113.10",
        }),
      CaptchaRequiredError,
    );
  } finally {
    await h.cleanup();
  }
});

Deno.test("password-reset CAPTCHA failure preserves generic response and suppresses token issuance", async () => {
  const h = await setup();
  try {
    await h.auth.register({
      username: "alice",
      email: "alice@example.com",
      password: "correct-horse-battery",
      displayName: "Alice",
    });
    const captcha = new RecordingCaptcha(false);
    const route = new PasswordResetRequestRoute(
      h.auth,
      new JsonCodec(),
      undefined,
      undefined,
      captcha,
    );
    const response = await route.handle({
      request: new Request("http://chat.test/api/auth/password-reset/request", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "attacker" },
        body: JSON.stringify({ email: "alice@example.com" }),
      }),
      params: {},
      clientIp: "192.0.2.5",
    });
    assertEquals(response.status, 200);
    assertEquals(captcha.contexts[0]?.clientIp, "192.0.2.5");
    const count = h.db.prepare("SELECT COUNT(*) count FROM password_reset_tokens").get() as {
      count: number;
    };
    assertEquals(count.count, 0);
  } finally {
    await h.cleanup();
  }
});
