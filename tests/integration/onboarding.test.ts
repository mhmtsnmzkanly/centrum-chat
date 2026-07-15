import { assertEquals } from "jsr:@std/assert@1";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { RouteRegistry } from "../../src/application/http/routeRegistry.ts";
import { WebSocketHandlerRegistry } from "../../src/application/websocket/registry.ts";
import { RegisterRoute } from "../../src/application/http/routes/auth/registerRoute.ts";
import { LoginRoute } from "../../src/application/http/routes/auth/loginRoute.ts";
import { RefreshRoute } from "../../src/application/http/routes/auth/refreshRoute.ts";
import {
  CompleteOnboardingPreferencesRoute,
  GetOnboardingStatusRoute,
} from "../../src/application/http/routes/auth/onboardingRoutes.ts";
import { PublicConfigRoute } from "../../src/application/http/routes/config/publicConfigRoute.ts";
import { handleWsUpgrade } from "../../src/transport/http/wsUpgrade.ts";
import { startHttpServer } from "../../src/transport/http/httpServer.ts";
import { ConnectionManager } from "../../src/transport/websocket/connectionManager.ts";
import { createTestDb } from "../support/testDatabase.ts";
import { waitForOpenOrError } from "../support/wsTestClient.ts";
import { SqliteTransactionManager } from "../../src/storage/db.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteUserSessionRepository } from "../../src/storage/repositories/sqliteUserSessionRepository.ts";
import { SqlitePreferencesRepository } from "../../src/storage/repositories/sqlitePreferencesRepository.ts";
import { SqliteEmailVerificationTokenRepository } from "../../src/storage/repositories/sqliteEmailVerificationTokenRepository.ts";
import { SqlitePasswordResetTokenRepository } from "../../src/storage/repositories/sqlitePasswordResetTokenRepository.ts";
import { SqliteEmailChangeTokenRepository } from "../../src/storage/repositories/sqliteEmailChangeTokenRepository.ts";
import { WebCryptoPasswordHasher } from "../../src/domain/auth/webCryptoPasswordHasher.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { AuthService } from "../../src/domain/auth/authService.ts";
import { AccountPolicy } from "../../src/domain/auth/accountPolicy.ts";
import { OnboardingService } from "../../src/domain/auth/onboardingService.ts";
import type { SettingsService } from "../../src/domain/administration/settingsService.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";
import { FakeMailService } from "../support/fakeMailService.ts";
import { CompleteEmailVerificationRoute } from "../../src/application/http/routes/auth/completeEmailVerificationRoute.ts";

const PREFERENCES = {
  bio: "Onboarded profile",
  avatarSeed: "sunrise",
  coverIndex: 1,
  nameColor: "#12ABEF",
  sound: true,
  desktopNotifications: false,
  dmPrivacy: "group_members",
  groupPrivacy: "dm_contacts",
  theme: "dark",
};

async function bootOnboardingServer(emailVerificationRequired: boolean) {
  const database = await createTestDb();
  const logger = createLogger("error", "test-onboarding");
  const codec = new JsonCodec();
  const tokenService = new TokenService({
    secret: "onboarding-secret",
    accessTokenTtlSeconds: 900,
  });
  const users = new SqliteUserRepository(database.db);
  const sessions = new SqliteUserSessionRepository(database.db);
  const preferences = new SqlitePreferencesRepository(database.db);
  const mail = new FakeMailService();
  const settings = {
    get<T>(key: string): T {
      if (key !== "email_verification_required") throw new Error(`unexpected setting ${key}`);
      return emailVerificationRequired as T;
    },
  } as SettingsService;
  const auth = new AuthService({
    users,
    userSessions: sessions,
    emailVerificationTokens: new SqliteEmailVerificationTokenRepository(database.db),
    passwordResetTokens: new SqlitePasswordResetTokenRepository(database.db),
    emailChangeTokens: new SqliteEmailChangeTokenRepository(database.db),
    passwordHasher: new WebCryptoPasswordHasher(),
    tokenService,
    transactions: new SqliteTransactionManager(database.db),
    mailService: mail,
    logger,
    sessionDefaultTtlMs: 86_400_000,
    sessionRememberedTtlMs: 2_592_000_000,
    emailVerificationTtlMs: 3_600_000,
    passwordResetTtlMs: 1_800_000,
    emailChangeTtlMs: 3_600_000,
    publicBaseUrl: "https://chat.example.com",
  });
  const onboarding = new OnboardingService(
    users,
    preferences,
    settings,
    new SqliteTransactionManager(database.db),
  );
  const accountPolicy = new AccountPolicy(users, settings);
  const registry = new RouteRegistry();
  registry.register(new RegisterRoute(auth, codec));
  registry.register(
    new LoginRoute(auth, new RateLimiter({ maxTokens: 20, refillIntervalMs: 60_000 }), codec),
  );
  registry.register(new RefreshRoute(auth, codec));
  registry.register(new CompleteEmailVerificationRoute(auth, codec));
  registry.register(new GetOnboardingStatusRoute(onboarding, tokenService, codec));
  registry.register(new CompleteOnboardingPreferencesRoute(onboarding, tokenService, codec));
  registry.register(
    new PublicConfigRoute(codec, "none", "", () => emailVerificationRequired),
  );

  const wsRegistry = new WebSocketHandlerRegistry(undefined, undefined, accountPolicy);
  const connectionManager = new ConnectionManager({ logger });
  const server = startHttpServer({
    host: "127.0.0.1",
    port: 0,
    registry,
    codec,
    logger,
    wsUpgrade: (request, clientIp) =>
      handleWsUpgrade(request, {
        clientIp,
        registry: wsRegistry,
        connectionManager,
        codec,
        logger,
        tokenService,
        accountPolicy,
      }),
  });
  const port = (server.addr as Deno.NetAddr).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    mail,
    cleanup: async () => {
      connectionManager.shutdownAllConnections(1001, "Test shutdown.");
      await server.shutdown();
      await database.cleanup();
    },
  };
}

async function register(baseUrl: string, username: string) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    body: JSON.stringify({
      username,
      email: `${username}@example.com`,
      password: "correct-horse-battery",
      displayName: username,
    }),
  });
  assertEquals(response.status, 201);
  return (await response.json()).data as {
    user: { id: string };
    accessToken: string;
    refreshToken: string;
  };
}

async function onboardingStatus(baseUrl: string, accessToken: string) {
  const response = await fetch(`${baseUrl}/api/auth/onboarding`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assertEquals(response.status, 200);
  return (await response.json()).data as Record<string, unknown>;
}

async function completePreferences(baseUrl: string, accessToken: string) {
  const response = await fetch(`${baseUrl}/api/auth/onboarding/preferences`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(PREFERENCES),
  });
  return { response, body: await response.json() };
}

Deno.test("onboarding HTTP flow without verification persists preferences and unlocks chat", async () => {
  const harness = await bootOnboardingServer(false);
  try {
    const session = await register(harness.baseUrl, "onboarding_disabled");
    const initial = await onboardingStatus(harness.baseUrl, session.accessToken);
    assertEquals(initial.currentOnboardingStep, "preferences");
    assertEquals(initial.onboardingComplete, false);

    const blockedSocket = new WebSocket(`${harness.wsUrl}/ws?token=${session.accessToken}`);
    assertEquals(await waitForOpenOrError(blockedSocket), "error");

    const completed = await completePreferences(harness.baseUrl, session.accessToken);
    assertEquals(completed.response.status, 200);
    assertEquals(completed.body.data.onboardingComplete, true);
    assertEquals(completed.body.data.profile.bio, PREFERENCES.bio);
    assertEquals(completed.body.data.preferences.dmPrivacy, PREFERENCES.dmPrivacy);

    const repeated = await completePreferences(harness.baseUrl, session.accessToken);
    assertEquals(repeated.response.status, 200);
    assertEquals(repeated.body.data.onboardingComplete, true);

    const allowedSocket = new WebSocket(`${harness.wsUrl}/ws?token=${session.accessToken}`);
    assertEquals(await waitForOpenOrError(allowedSocket), "open");
    allowedSocket.close();
  } finally {
    await harness.cleanup();
  }
});

Deno.test("unfinished onboarding resumes after login and refresh", async () => {
  const harness = await bootOnboardingServer(false);
  try {
    const registered = await register(harness.baseUrl, "onboarding_resume");
    const loginResponse = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({
        email: "onboarding_resume@example.com",
        password: "correct-horse-battery",
      }),
    });
    assertEquals(loginResponse.status, 200);
    const login = (await loginResponse.json()).data;
    assertEquals(
      (await onboardingStatus(harness.baseUrl, login.accessToken)).currentOnboardingStep,
      "preferences",
    );

    const refreshResponse = await fetch(`${harness.baseUrl}/api/auth/refresh`, {
      method: "POST",
      body: JSON.stringify({ refreshToken: registered.refreshToken }),
    });
    assertEquals(refreshResponse.status, 200);
    const refreshed = (await refreshResponse.json()).data;
    assertEquals(
      (await onboardingStatus(harness.baseUrl, refreshed.accessToken)).currentOnboardingStep,
      "preferences",
    );
  } finally {
    await harness.cleanup();
  }
});

Deno.test("verification-required onboarding blocks chat until server confirms verification", async () => {
  const harness = await bootOnboardingServer(true);
  try {
    const configResponse = await fetch(`${harness.baseUrl}/api/config/public`);
    assertEquals((await configResponse.json()).data.emailVerificationRequired, true);

    const session = await register(harness.baseUrl, "onboarding_verified");
    const saved = await completePreferences(harness.baseUrl, session.accessToken);
    assertEquals(saved.body.data.currentOnboardingStep, "email-verification");
    assertEquals(saved.body.data.onboardingComplete, false);

    const blockedSocket = new WebSocket(`${harness.wsUrl}/ws?token=${session.accessToken}`);
    assertEquals(await waitForOpenOrError(blockedSocket), "error");

    const verificationUrl = harness.mail.latest("verification")?.input.verificationUrl;
    const verificationToken = verificationUrl
      ? new URL(verificationUrl).searchParams.get("verify_email")
      : null;
    const verificationResponse = await fetch(
      `${harness.baseUrl}/api/auth/verify-email/complete`,
      {
        method: "POST",
        body: JSON.stringify({ token: verificationToken }),
      },
    );
    assertEquals(verificationResponse.status, 200);

    const repeatedVerification = await fetch(
      `${harness.baseUrl}/api/auth/verify-email/complete`,
      {
        method: "POST",
        body: JSON.stringify({ token: verificationToken }),
      },
    );
    assertEquals(repeatedVerification.status, 401);
    const completed = await onboardingStatus(harness.baseUrl, session.accessToken);
    assertEquals(completed.emailVerified, true);
    assertEquals(completed.onboardingComplete, true);
    assertEquals(completed.currentOnboardingStep, "complete");

    const allowedSocket = new WebSocket(`${harness.wsUrl}/ws?token=${session.accessToken}`);
    assertEquals(await waitForOpenOrError(allowedSocket), "open");
    allowedSocket.close();
  } finally {
    await harness.cleanup();
  }
});
