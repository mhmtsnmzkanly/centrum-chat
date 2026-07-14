import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { RouteRegistry } from "../../src/application/http/routeRegistry.ts";
import { WebSocketHandlerRegistry } from "../../src/application/websocket/registry.ts";
import { errorResponse } from "../../src/application/http/responses.ts";
import { translateError } from "../../src/application/middleware/errorBoundary.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteUserSessionRepository } from "../../src/storage/repositories/sqliteUserSessionRepository.ts";
import { SqliteEmailVerificationTokenRepository } from "../../src/storage/repositories/sqliteEmailVerificationTokenRepository.ts";
import { SqlitePasswordResetTokenRepository } from "../../src/storage/repositories/sqlitePasswordResetTokenRepository.ts";
import { SqliteEmailChangeTokenRepository } from "../../src/storage/repositories/sqliteEmailChangeTokenRepository.ts";
import { SqliteConversationRepository } from "../../src/storage/repositories/sqliteConversationRepository.ts";
import { SqliteConversationMembershipRepository } from "../../src/storage/repositories/sqliteConversationMembershipRepository.ts";
import { SqliteConversationReadRepository } from "../../src/storage/repositories/sqliteConversationReadRepository.ts";
import { SqliteMessageRepository } from "../../src/storage/repositories/sqliteMessageRepository.ts";
import { SqliteReactionRepository } from "../../src/storage/repositories/sqliteReactionRepository.ts";
import { SqliteAttachmentRepository } from "../../src/storage/repositories/sqliteAttachmentRepository.ts";
import { SqliteNotificationRepository } from "../../src/storage/repositories/sqliteNotificationRepository.ts";
import { SqlitePreferencesRepository } from "../../src/storage/repositories/sqlitePreferencesRepository.ts";
import { SqliteDirectConversationPairRepository } from "../../src/storage/repositories/sqliteDirectConversationPairRepository.ts";
import { SqliteTransactionManager } from "../../src/storage/db.ts";
import { createTestDb } from "../support/testDatabase.ts";
import { WebCryptoPasswordHasher } from "../../src/domain/auth/webCryptoPasswordHasher.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { AuthService } from "../../src/domain/auth/authService.ts";
import { AccountPolicy } from "../../src/domain/auth/accountPolicy.ts";
import { PermissionService } from "../../src/domain/permissions/permissionService.ts";
import { MessageService } from "../../src/domain/messages/messageService.ts";
import { ConversationReadService } from "../../src/domain/conversations/conversationReadService.ts";
import { GroupService } from "../../src/domain/conversations/groupService.ts";
import { DmService } from "../../src/domain/conversations/dmService.ts";
import { NotificationService } from "../../src/domain/notifications/notificationService.ts";
import { ReactionService } from "../../src/domain/reactions/reactionService.ts";
import { SearchService } from "../../src/domain/search/searchService.ts";
import { AttachmentService } from "../../src/domain/attachments/attachmentService.ts";
import { UserService } from "../../src/domain/users/userService.ts";
import { PresenceService } from "../../src/domain/presence/presenceService.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";
import { createPresenceAwareConnectionManager } from "../support/testConnectionManager.ts";
import { FakeMailService } from "../support/fakeMailService.ts";
import { RegisterRoute } from "../../src/application/http/routes/auth/registerRoute.ts";
import { LoginRoute } from "../../src/application/http/routes/auth/loginRoute.ts";
import { RefreshRoute } from "../../src/application/http/routes/auth/refreshRoute.ts";
import { LogoutRoute } from "../../src/application/http/routes/auth/logoutRoute.ts";
import { ChangePasswordRoute } from "../../src/application/http/routes/auth/changePasswordRoute.ts";
import { AccountRoute } from "../../src/application/http/routes/auth/accountRoute.ts";
import { ListSessionsRoute } from "../../src/application/http/routes/auth/listSessionsRoute.ts";
import { RevokeSessionRoute } from "../../src/application/http/routes/auth/revokeSessionRoute.ts";
import { RevokeOtherSessionsRoute } from "../../src/application/http/routes/auth/revokeOtherSessionsRoute.ts";
import { ResendVerificationRoute } from "../../src/application/http/routes/auth/resendVerificationRoute.ts";
import { CompleteEmailVerificationRoute } from "../../src/application/http/routes/auth/completeEmailVerificationRoute.ts";
import { PasswordResetRequestRoute } from "../../src/application/http/routes/auth/passwordResetRequestRoute.ts";
import { PasswordResetCompleteRoute } from "../../src/application/http/routes/auth/passwordResetCompleteRoute.ts";
import { StartEmailChangeRoute } from "../../src/application/http/routes/auth/startEmailChangeRoute.ts";
import { CompleteEmailChangeRoute } from "../../src/application/http/routes/auth/completeEmailChangeRoute.ts";
import { UploadRoute } from "../../src/application/http/routes/media/uploadRoute.ts";
import { AvatarRoute } from "../../src/application/http/routes/media/avatarRoute.ts";
import { CoverRoute } from "../../src/application/http/routes/media/coverRoute.ts";
import { SystemPongHandler } from "../../src/application/websocket/handlers/system/systemPongHandler.ts";
import { SendMessageHandler } from "../../src/application/websocket/handlers/messages/sendMessageHandler.ts";
import { OpenDmHandler } from "../../src/application/websocket/handlers/dm/openDmHandler.ts";
import { CreateGroupHandler } from "../../src/application/websocket/handlers/groups/createGroupHandler.ts";
import { AddMemberHandler } from "../../src/application/websocket/handlers/groups/addMemberHandler.ts";
import { ToggleReactionHandler } from "../../src/application/websocket/handlers/reactions/toggleReactionHandler.ts";
import { SearchUsersHandler } from "../../src/application/websocket/handlers/search/searchUsersHandler.ts";
import { UnauthorizedError } from "../../src/shared/errors/unauthorizedError.ts";

interface SessionAuth {
  readonly userId: string;
  readonly email: string;
  readonly accessToken: string;
  readonly refreshToken: string;
}

function jsonHeaders(accessToken?: string): HeadersInit {
  return {
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    "Content-Type": "application/json",
  };
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function latestMailUrl(
  mailService: FakeMailService,
  purpose:
    | "verification"
    | "password_reset"
    | "email_change_verification",
  toEmail: string,
): string | null {
  const matches = mailService.deliveries.filter((delivery) =>
    delivery.purpose === purpose && delivery.input.toEmail === toEmail
  );
  const latest = matches[matches.length - 1];
  if (!latest) return null;
  switch (latest.purpose) {
    case "verification":
      return latest.input.verificationUrl;
    case "password_reset":
      return latest.input.resetUrl;
    case "email_change_verification":
      return latest.input.verificationUrl;
    default:
      return null;
  }
}

function getMailToken(url: string, key: string): string {
  const token = new URL(url).searchParams.get(key);
  if (!token) throw new Error(`Missing ${key} token`);
  return token;
}

function makeUploadForm(fileName: string, mimeType: string, bytes: Uint8Array): FormData {
  const form = new FormData();
  form.append("file", new File([bytes as unknown as BlobPart], fileName, { type: mimeType }));
  return form;
}

function makePngBytes(label: string): Uint8Array {
  const header = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const tail = new TextEncoder().encode(label);
  const bytes = new Uint8Array(header.length + tail.length);
  bytes.set(header, 0);
  bytes.set(tail, header.length);
  return bytes;
}

async function bootHarness() {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const mediaRoot = await Deno.makeTempDir({ prefix: "centrumchat-account-media-" });
  const logger = createLogger("error", "test-account-security");
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  const wsRegistry = new WebSocketHandlerRegistry();
  const tokenService = new TokenService({ secret: "test-secret", accessTokenTtlSeconds: 900 });
  const mailService = new FakeMailService();
  const transactionManager = new SqliteTransactionManager(db);

  const userRepository = new SqliteUserRepository(db);
  const userSessionRepository = new SqliteUserSessionRepository(db);
  const emailVerificationTokenRepository = new SqliteEmailVerificationTokenRepository(db);
  const passwordResetTokenRepository = new SqlitePasswordResetTokenRepository(db);
  const emailChangeTokenRepository = new SqliteEmailChangeTokenRepository(db);
  const conversationRepository = new SqliteConversationRepository(db);
  const membershipRepository = new SqliteConversationMembershipRepository(db);
  const readRepository = new SqliteConversationReadRepository(db);
  const messageRepository = new SqliteMessageRepository(db);
  const reactionRepository = new SqliteReactionRepository(db);
  const attachmentRepository = new SqliteAttachmentRepository(db);
  const notificationRepository = new SqliteNotificationRepository(db);
  const preferencesRepository = new SqlitePreferencesRepository(db);
  const directPairRepository = new SqliteDirectConversationPairRepository(db);

  const authService = new AuthService({
    users: userRepository,
    userSessions: userSessionRepository,
    emailVerificationTokens: emailVerificationTokenRepository,
    passwordResetTokens: passwordResetTokenRepository,
    emailChangeTokens: emailChangeTokenRepository,
    passwordHasher: new WebCryptoPasswordHasher(),
    tokenService,
    transactions: transactionManager,
    mailService,
    logger,
    sessionDefaultTtlMs: 86_400_000,
    sessionRememberedTtlMs: 2_592_000_000,
    emailVerificationTtlMs: 3_600_000,
    passwordResetTtlMs: 1_800_000,
    emailChangeTtlMs: 3_600_000,
    publicBaseUrl: "https://chat.example.com",
  });

  const userService = new UserService(userRepository);
  const attachmentService = new AttachmentService(attachmentRepository);
  const permissionService = new PermissionService(membershipRepository);
  const messageService = new MessageService(
    messageRepository,
    conversationRepository,
    permissionService,
    new RateLimiter({ maxTokens: 1_000, refillIntervalMs: 10_000 }),
    transactionManager,
    reactionRepository,
    attachmentRepository,
  );
  const readService = new ConversationReadService(
    readRepository,
    conversationRepository,
    permissionService,
  );
  const groupService = new GroupService(
    conversationRepository,
    membershipRepository,
    userRepository,
    preferencesRepository,
  );
  const dmService = new DmService(
    conversationRepository,
    membershipRepository,
    directPairRepository,
    userRepository,
    preferencesRepository,
    transactionManager,
  );
  const notificationService = new NotificationService(notificationRepository, userRepository);
  const reactionService = new ReactionService(
    reactionRepository,
    messageRepository,
    conversationRepository,
    permissionService,
  );
  const searchService = new SearchService(
    messageRepository,
    messageService,
    conversationRepository,
    permissionService,
    userRepository,
  );
  const accountPolicy = new AccountPolicy(userRepository);
  const presenceService = new PresenceService(userRepository);
  const connectionManager = createPresenceAwareConnectionManager(presenceService, codec);

  registry.register(new RegisterRoute(authService, codec));
  registry.register(
    new LoginRoute(
      authService,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
      codec,
    ),
  );
  registry.register(new RefreshRoute(authService, codec));
  registry.register(new LogoutRoute(authService, tokenService, codec));
  registry.register(new ChangePasswordRoute(authService, tokenService, codec));
  registry.register(new AccountRoute(authService, tokenService, codec));
  registry.register(new ListSessionsRoute(authService, tokenService, codec));
  registry.register(
    new RevokeOtherSessionsRoute(
      authService,
      tokenService,
      codec,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
    ),
  );
  registry.register(
    new RevokeSessionRoute(
      authService,
      tokenService,
      codec,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
    ),
  );
  registry.register(
    new ResendVerificationRoute(
      authService,
      tokenService,
      codec,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
    ),
  );
  registry.register(
    new CompleteEmailVerificationRoute(
      authService,
      codec,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
    ),
  );
  registry.register(
    new PasswordResetRequestRoute(
      authService,
      codec,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
    ),
  );
  registry.register(
    new PasswordResetCompleteRoute(
      authService,
      codec,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
    ),
  );
  registry.register(
    new StartEmailChangeRoute(
      authService,
      tokenService,
      codec,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
    ),
  );
  registry.register(
    new CompleteEmailChangeRoute(
      authService,
      tokenService,
      codec,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
    ),
  );
  registry.register(
    new UploadRoute(
      tokenService,
      attachmentService,
      mediaRoot,
      5_242_880,
      codec,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
      accountPolicy,
    ),
  );
  registry.register(
    new AvatarRoute(
      tokenService,
      attachmentService,
      userService,
      mediaRoot,
      5_242_880,
      codec,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
      accountPolicy,
    ),
  );
  registry.register(
    new CoverRoute(
      tokenService,
      attachmentService,
      userService,
      mediaRoot,
      5_242_880,
      codec,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
      accountPolicy,
    ),
  );

  wsRegistry.register(new SystemPongHandler());
  wsRegistry.register(
    new SendMessageHandler(
      messageService,
      readService,
      conversationRepository,
      membershipRepository,
      notificationService,
      connectionManager,
      codec,
      accountPolicy,
    ),
  );
  wsRegistry.register(
    new OpenDmHandler(
      dmService,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
      accountPolicy,
    ),
  );
  wsRegistry.register(
    new CreateGroupHandler(
      groupService,
      messageService,
      conversationRepository,
      membershipRepository,
      notificationService,
      transactionManager,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
      connectionManager,
      codec,
      accountPolicy,
    ),
  );
  wsRegistry.register(
    new AddMemberHandler(
      groupService,
      messageService,
      conversationRepository,
      membershipRepository,
      notificationService,
      transactionManager,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
      connectionManager,
      codec,
      accountPolicy,
    ),
  );
  wsRegistry.register(
    new ToggleReactionHandler(
      reactionService,
      conversationRepository,
      membershipRepository,
      notificationService,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 60_000 }),
      connectionManager,
      codec,
      accountPolicy,
    ),
  );
  wsRegistry.register(new SearchUsersHandler(searchService, accountPolicy));

  async function dispatchHttp(
    path: string,
    init: RequestInit & { clientIp?: string } = {},
  ): Promise<Response> {
    const { clientIp = "127.0.0.1", ...requestInit } = init;
    try {
      const response = await registry.dispatch(
        new Request(`http://chat.test${path}`, requestInit),
        clientIp,
      );
      if (response) return response;
      return errorResponse(codec, { code: "NOT_FOUND", message: "No such route." }, 404);
    } catch (error) {
      const { payload, httpStatus } = translateError(error, logger.child("http-test"));
      return errorResponse(codec, payload, httpStatus);
    }
  }

  async function registerUser(label: string, rememberMe = false): Promise<SessionAuth> {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `${label}_${suffix}@example.com`;
    const response = await dispatchHttp("/api/auth/register", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        username: `${label}_${suffix}`,
        email,
        password: "correct-horse-battery",
        displayName: `${label} display`,
        rememberMe,
        deviceLabel: `${label} device`,
      }),
    });
    const body = await parseJson(response);
    const data = body.data as Record<string, unknown>;
    const user = data.user as Record<string, unknown>;
    return {
      userId: String(user.id),
      email,
      accessToken: String(data.accessToken),
      refreshToken: String(data.refreshToken),
    };
  }

  async function loginUser(email: string, rememberMe = false): Promise<SessionAuth> {
    const response = await dispatchHttp("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        email,
        password: "correct-horse-battery",
        rememberMe,
        deviceLabel: "browser",
      }),
    });
    const body = await parseJson(response);
    if (response.status !== 200) {
      throw new UnauthorizedError(
        String((body.error as Record<string, unknown>)?.message ?? "Unauthorized"),
      );
    }
    const data = body.data as Record<string, unknown>;
    const user = data.user as Record<string, unknown>;
    return {
      userId: String(user.id),
      email,
      accessToken: String(data.accessToken),
      refreshToken: String(data.refreshToken),
    };
  }

  async function verifyEmailFor(email: string): Promise<void> {
    const url = latestMailUrl(mailService, "verification", email);
    if (!url) throw new Error(`No verification mail for ${email}`);
    await authService.verifyEmail(getMailToken(url, "verify_email"));
  }

  async function dispatchWs(
    userId: string,
    event: string,
    data: unknown,
    id = crypto.randomUUID(),
  ) {
    return await wsRegistry.dispatch(
      { userId, connectionId: `conn-${userId}` },
      { id, event, data },
      logger.child("ws-test"),
    );
  }

  function createPublicChannel(slug: string): string {
    return conversationRepository.create({
      id: crypto.randomUUID(),
      type: "channel",
      slug,
      isPublic: true,
    }).id;
  }

  function createOwnedGroup(ownerUserId: string): string {
    const room = conversationRepository.create({
      id: crypto.randomUUID(),
      type: "group",
      name: "Owned Group",
      isPublic: false,
      ownerId: ownerUserId,
    });
    membershipRepository.add(room.id, ownerUserId, "owner");
    return room.id;
  }

  function createChannelMessage(conversationId: string, authorId: string): string {
    return messageRepository.create({
      id: crypto.randomUUID(),
      conversationId,
      authorId,
      content: "hello world",
      replyToId: null,
      isSystem: false,
    }).id;
  }

  return {
    authService,
    mailService,
    dispatchHttp,
    dispatchWs,
    registerUser,
    loginUser,
    verifyEmailFor,
    createPublicChannel,
    createOwnedGroup,
    createChannelMessage,
    cleanup: async () => {
      await cleanupDb();
      await Deno.remove(mediaRoot, { recursive: true });
    },
  };
}

Deno.test("Account security HTTP routes list sessions, reject cross-user revoke, and revoke the current session", async () => {
  const harness = await bootHarness();
  try {
    const aliceFirst = await harness.registerUser("alice");
    await harness.verifyEmailFor(aliceFirst.email);
    const aliceSecond = await harness.loginUser(aliceFirst.email, true);
    const bob = await harness.registerUser("bob");

    const listResponse = await harness.dispatchHttp("/api/auth/sessions", {
      headers: jsonHeaders(aliceSecond.accessToken),
    });
    assertEquals(listResponse.status, 200);
    const listBody = await parseJson(listResponse);
    const sessions = (listBody.data as Record<string, unknown>).sessions as Array<
      Record<string, unknown>
    >;
    assertEquals(sessions.length, 2);
    assertEquals(sessions.every((session) => session.refreshTokenHash === undefined), true);
    const currentSession = sessions.find((session) => session.current === true);
    const otherSession = sessions.find((session) => session.current !== true);
    assertEquals(currentSession?.remembered, true);

    const crossUserRevoke = await harness.dispatchHttp(
      `/api/auth/sessions/${encodeURIComponent(String(otherSession?.id))}`,
      {
        method: "DELETE",
        headers: jsonHeaders(bob.accessToken),
      },
    );
    assertEquals(crossUserRevoke.status, 404);

    const revokeCurrent = await harness.dispatchHttp(
      `/api/auth/sessions/${encodeURIComponent(String(currentSession?.id))}`,
      {
        method: "DELETE",
        headers: jsonHeaders(aliceSecond.accessToken),
      },
    );
    assertEquals(revokeCurrent.status, 200);
    const revokeBody = await parseJson(revokeCurrent);
    assertEquals((revokeBody.data as Record<string, unknown>).revokedCurrent, true);

    const staleRefresh = await harness.dispatchHttp("/api/auth/refresh", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ refreshToken: aliceSecond.refreshToken }),
    });
    assertEquals(staleRefresh.status, 401);
  } finally {
    await harness.cleanup();
  }
});

Deno.test("Session list exposes client metadata captured at login, updated on refresh, and keeps revoked sessions as history", async () => {
  const harness = await bootHarness();
  try {
    const registered = await harness.registerUser("alice");

    // A second session from a distinct client (custom IP + User-Agent).
    const loginResponse = await harness.dispatchHttp("/api/auth/login", {
      method: "POST",
      headers: { ...jsonHeaders(), "user-agent": "IntegrationBrowser/9.9" },
      clientIp: "203.0.113.9",
      body: JSON.stringify({
        email: registered.email,
        password: "correct-horse-battery",
        deviceLabel: "phone",
      }),
    });
    assertEquals(loginResponse.status, 200);
    const loginData = (await parseJson(loginResponse)).data as Record<string, unknown>;
    const loginAccessToken = String(loginData.accessToken);
    const loginRefreshToken = String(loginData.refreshToken);

    async function listSessions(): Promise<Array<Record<string, unknown>>> {
      const response = await harness.dispatchHttp("/api/auth/sessions", {
        headers: jsonHeaders(loginAccessToken),
      });
      assertEquals(response.status, 200);
      const body = await parseJson(response);
      return (body.data as Record<string, unknown>).sessions as Array<Record<string, unknown>>;
    }

    let sessions = await listSessions();
    assertEquals(sessions.length, 2);
    const current = sessions.find((s) => s.current === true)!;
    const other = sessions.find((s) => s.current !== true)!;
    assertEquals(current.ipAddress, "203.0.113.9");
    assertEquals(current.userAgent, "IntegrationBrowser/9.9");
    assertEquals(current.revokedAt, null);
    // The registration session used the harness default socket address and no UA header.
    assertEquals(other.ipAddress, "127.0.0.1");
    assertEquals(other.userAgent, null);

    // Refresh from a new network/client updates the stored metadata.
    const refreshResponse = await harness.dispatchHttp("/api/auth/refresh", {
      method: "POST",
      headers: { ...jsonHeaders(), "user-agent": "RefreshedClient/2.0" },
      clientIp: "198.51.100.7",
      body: JSON.stringify({ refreshToken: loginRefreshToken }),
    });
    assertEquals(refreshResponse.status, 200);
    sessions = await listSessions();
    const refreshed = sessions.find((s) => s.id === current.id)!;
    assertEquals(refreshed.ipAddress, "198.51.100.7");
    assertEquals(refreshed.userAgent, "RefreshedClient/2.0");

    // Revoking the other session keeps it listed as history, flagged via revokedAt.
    const revokeResponse = await harness.dispatchHttp(
      `/api/auth/sessions/${encodeURIComponent(String(other.id))}`,
      { method: "DELETE", headers: jsonHeaders(loginAccessToken) },
    );
    assertEquals(revokeResponse.status, 200);
    sessions = await listSessions();
    assertEquals(sessions.length, 2);
    const revoked = sessions.find((s) => s.id === other.id)!;
    assertEquals(typeof revoked.revokedAt, "string");
    // Active sessions are ordered before revoked history entries.
    assertEquals(sessions[0]?.id, current.id);
  } finally {
    await harness.cleanup();
  }
});

Deno.test("Email verification uses PUBLIC_BASE_URL and exactly one concurrent completion succeeds", async () => {
  const harness = await bootHarness();
  try {
    const registerResponse = await harness.dispatchHttp("/api/auth/register", {
      method: "POST",
      headers: {
        ...jsonHeaders(),
        Host: "attacker.example",
        Origin: "https://origin.attacker.example",
        "X-Forwarded-Host": "forwarded.attacker.example",
        "X-Forwarded-Proto": "http",
      },
      body: JSON.stringify({
        username: "alice_security",
        email: "alice.security@example.com",
        password: "correct-horse-battery",
        displayName: "Alice Security",
      }),
    });
    assertEquals(registerResponse.status, 201);

    const verificationUrl = latestMailUrl(
      harness.mailService,
      "verification",
      "alice.security@example.com",
    );
    assertEquals(verificationUrl?.startsWith("https://chat.example.com/"), true);
    const token = getMailToken(verificationUrl ?? "", "verify_email");

    const [first, second] = await Promise.all([
      harness.dispatchHttp("/api/auth/verify-email/complete", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ token }),
      }),
      harness.dispatchHttp("/api/auth/verify-email/complete", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ token }),
      }),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    assertEquals(statuses, [200, 401]);
  } finally {
    await harness.cleanup();
  }
});

Deno.test("Password reset is enumeration-resistant, uses PUBLIC_BASE_URL, and revokes sessions on completion", async () => {
  const harness = await bootHarness();
  try {
    const alice = await harness.registerUser("alice");
    await harness.verifyEmailFor(alice.email);
    const extraSession = await harness.loginUser(alice.email);

    const existing = await harness.dispatchHttp("/api/auth/password-reset/request", {
      method: "POST",
      headers: {
        ...jsonHeaders(),
        Host: "bad.example",
        Origin: "https://bad.example",
        "X-Forwarded-Host": "forwarded.bad.example",
        "X-Forwarded-Proto": "http",
      },
      body: JSON.stringify({ email: alice.email }),
    });
    const existingText = await existing.text();
    const missing = await harness.dispatchHttp("/api/auth/password-reset/request", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ email: "nobody@example.com" }),
    });
    const missingText = await missing.text();
    assertEquals(existing.status, 200);
    assertEquals(missing.status, 200);
    assertEquals(existingText, missingText);

    const resetUrl = latestMailUrl(harness.mailService, "password_reset", alice.email);
    assertEquals(resetUrl?.startsWith("https://chat.example.com/"), true);
    const token = getMailToken(resetUrl ?? "", "reset_password");

    const [first, second] = await Promise.all([
      harness.dispatchHttp("/api/auth/password-reset/complete", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ token, newPassword: "new-correct-horse-battery" }),
      }),
      harness.dispatchHttp("/api/auth/password-reset/complete", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ token, newPassword: "new-correct-horse-battery" }),
      }),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    assertEquals(statuses, [200, 401]);

    const refreshed = await harness.dispatchHttp("/api/auth/refresh", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ refreshToken: extraSession.refreshToken }),
    });
    assertEquals(refreshed.status, 401);
    await assertRejects(() => harness.loginUser(alice.email), UnauthorizedError);
  } finally {
    await harness.cleanup();
  }
});

Deno.test("Password reset invalidates a pending email change despite a still-valid access token", async () => {
  const harness = await bootHarness();
  try {
    const alice = await harness.registerUser("alice");
    await harness.verifyEmailFor(alice.email);
    const startChange = await harness.dispatchHttp("/api/auth/email-change/start", {
      method: "POST",
      headers: jsonHeaders(alice.accessToken),
      body: JSON.stringify({
        currentPassword: "correct-horse-battery",
        newEmail: "alice.pending@example.com",
      }),
    });
    assertEquals(startChange.status, 200);
    const changeToken = getMailToken(
      latestMailUrl(
        harness.mailService,
        "email_change_verification",
        "alice.pending@example.com",
      ) ?? "",
      "change_email",
    );

    await harness.authService.requestPasswordReset(alice.email);
    const resetToken = getMailToken(
      latestMailUrl(harness.mailService, "password_reset", alice.email) ?? "",
      "reset_password",
    );
    await harness.authService.completePasswordReset(resetToken, "replacement-password");

    const staleCompletion = await harness.dispatchHttp("/api/auth/email-change/complete", {
      method: "POST",
      headers: jsonHeaders(alice.accessToken),
      body: JSON.stringify({ token: changeToken }),
    });
    assertEquals(staleCompletion.status, 401);
  } finally {
    await harness.cleanup();
  }
});

Deno.test("Password change enforces policy, preserves only its trusted current session, and cancels pending email change", async () => {
  const harness = await bootHarness();
  try {
    const first = await harness.registerUser("alice");
    await harness.verifyEmailFor(first.email);
    const current = await harness.loginUser(first.email, true);

    const weakChange = await harness.dispatchHttp("/api/auth/change-password", {
      method: "POST",
      headers: jsonHeaders(current.accessToken),
      body: JSON.stringify({
        currentPassword: "correct-horse-battery",
        newPassword: "short",
      }),
    });
    assertEquals(weakChange.status, 400);

    await harness.dispatchHttp("/api/auth/email-change/start", {
      method: "POST",
      headers: jsonHeaders(current.accessToken),
      body: JSON.stringify({
        currentPassword: "correct-horse-battery",
        newEmail: "alice.pending@example.com",
      }),
    });
    const changeToken = getMailToken(
      latestMailUrl(
        harness.mailService,
        "email_change_verification",
        "alice.pending@example.com",
      ) ?? "",
      "change_email",
    );

    const changed = await harness.dispatchHttp("/api/auth/change-password", {
      method: "POST",
      headers: jsonHeaders(current.accessToken),
      body: JSON.stringify({
        currentPassword: "correct-horse-battery",
        newPassword: "replacement-password",
      }),
    });
    assertEquals(changed.status, 200);

    const oldRefresh = await harness.dispatchHttp("/api/auth/refresh", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ refreshToken: first.refreshToken }),
    });
    const currentRefresh = await harness.dispatchHttp("/api/auth/refresh", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    assertEquals(oldRefresh.status, 401);
    assertEquals(currentRefresh.status, 200);

    const staleCompletion = await harness.dispatchHttp("/api/auth/email-change/complete", {
      method: "POST",
      headers: jsonHeaders(current.accessToken),
      body: JSON.stringify({ token: changeToken }),
    });
    assertEquals(staleCompletion.status, 401);
  } finally {
    await harness.cleanup();
  }
});

Deno.test("Email change completion is authenticated, user-bound, and old-email notice is emitted", async () => {
  const harness = await bootHarness();
  try {
    const alice = await harness.registerUser("alice");
    const bob = await harness.registerUser("bob");
    await harness.verifyEmailFor(alice.email);
    await harness.verifyEmailFor(bob.email);

    const start = await harness.dispatchHttp("/api/auth/email-change/start", {
      method: "POST",
      headers: {
        ...jsonHeaders(alice.accessToken),
        Host: "attacker.example",
        Origin: "https://attacker.example",
        "X-Forwarded-Host": "forwarded.attacker.example",
        "X-Forwarded-Proto": "http",
      },
      body: JSON.stringify({
        currentPassword: "correct-horse-battery",
        newEmail: "alice.new@example.com",
      }),
    });
    assertEquals(start.status, 200);

    const changeUrl = latestMailUrl(
      harness.mailService,
      "email_change_verification",
      "alice.new@example.com",
    );
    assertEquals(changeUrl?.startsWith("https://chat.example.com/"), true);
    const token = getMailToken(changeUrl ?? "", "change_email");

    const bobCompletion = await harness.dispatchHttp("/api/auth/email-change/complete", {
      method: "POST",
      headers: jsonHeaders(bob.accessToken),
      body: JSON.stringify({ token }),
    });
    assertEquals(bobCompletion.status, 401);

    const aliceCompletion = await harness.dispatchHttp("/api/auth/email-change/complete", {
      method: "POST",
      headers: jsonHeaders(alice.accessToken),
      body: JSON.stringify({ token }),
    });
    assertEquals(aliceCompletion.status, 200);
    const oldEmailNotice = harness.mailService.deliveries.find((delivery) =>
      delivery.purpose === "email_changed_notice" && delivery.input.toEmail === alice.email
    );
    assertEquals(oldEmailNotice !== undefined, true);
  } finally {
    await harness.cleanup();
  }
});

Deno.test("Unverified users are blocked from upload, avatar, and cover routes", async () => {
  const harness = await bootHarness();
  try {
    const unverified = await harness.registerUser("unverified");

    const uploadResponse = await harness.dispatchHttp("/api/media/upload", {
      method: "POST",
      headers: { authorization: `Bearer ${unverified.accessToken}` },
      body: makeUploadForm(
        "note.txt",
        "text/plain",
        new TextEncoder().encode("hello"),
      ),
    });
    const avatarResponse = await harness.dispatchHttp("/api/media/avatar", {
      method: "POST",
      headers: { authorization: `Bearer ${unverified.accessToken}` },
      body: makeUploadForm("avatar.png", "image/png", makePngBytes("avatar")),
    });
    const coverResponse = await harness.dispatchHttp("/api/media/cover", {
      method: "POST",
      headers: { authorization: `Bearer ${unverified.accessToken}` },
      body: makeUploadForm("cover.png", "image/png", makePngBytes("cover")),
    });

    assertEquals(uploadResponse.status, 403);
    assertEquals(avatarResponse.status, 403);
    assertEquals(coverResponse.status, 403);
    const uploadBody = await parseJson(uploadResponse);
    assertEquals((uploadBody.error as Record<string, unknown>).code, "EMAIL_VERIFICATION_REQUIRED");
  } finally {
    await harness.cleanup();
  }
});

Deno.test("Unverified users are blocked across WebSocket handlers while system.pong remains allowed", async () => {
  const harness = await bootHarness();
  try {
    const unverified = await harness.registerUser("unverified");
    const verified = await harness.registerUser("verified");
    await harness.verifyEmailFor(verified.email);

    const channelId = harness.createPublicChannel("security");
    const groupId = harness.createOwnedGroup(unverified.userId);
    const messageId = harness.createChannelMessage(channelId, verified.userId);

    const pongId = crypto.randomUUID();
    const pong = await harness.dispatchWs(unverified.userId, "system.pong", {}, pongId);
    assertEquals(pong.id, pongId);
    assertEquals(pong.success, true);

    const checks = await Promise.all([
      harness.dispatchWs(unverified.userId, "message.send", {
        conversationId: channelId,
        content: "hello",
      }, crypto.randomUUID()),
      harness.dispatchWs(
        unverified.userId,
        "dm.open",
        { userId: verified.userId },
        crypto.randomUUID(),
      ),
      harness.dispatchWs(unverified.userId, "group.create", {
        name: "Blocked Group",
        memberIds: [crypto.randomUUID(), crypto.randomUUID()],
      }, crypto.randomUUID()),
      harness.dispatchWs(unverified.userId, "group.addMember", {
        conversationId: groupId,
        userId: verified.userId,
      }, crypto.randomUUID()),
      harness.dispatchWs(unverified.userId, "reaction.toggle", {
        messageId,
        emoji: "👍",
      }, crypto.randomUUID()),
      harness.dispatchWs(
        unverified.userId,
        "search.users",
        { query: "ver" },
        crypto.randomUUID(),
      ),
    ]);

    for (const response of checks) {
      assertEquals(response.success, false);
      assertEquals(response.error?.code, "EMAIL_VERIFICATION_REQUIRED");
    }
  } finally {
    await harness.cleanup();
  }
});
