import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { AuthService } from "../../src/domain/auth/authService.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { WebCryptoPasswordHasher } from "../../src/domain/auth/webCryptoPasswordHasher.ts";
import { UnauthorizedError } from "../../src/shared/errors/unauthorizedError.ts";
import { ConflictError } from "../../src/shared/errors/conflictError.ts";
import { FakeUserRepository } from "../support/fakeUserRepository.ts";
import type {
  NewUserSession,
  SessionClientMetadata,
  UserSessionRecord,
  UserSessionRepository,
} from "../../src/domain/auth/userSessionRepository.port.ts";
import type {
  EmailVerificationTokenRecord,
  EmailVerificationTokenRepository,
  NewEmailVerificationToken,
} from "../../src/domain/auth/emailVerificationTokenRepository.port.ts";
import type {
  NewPasswordResetToken,
  PasswordResetTokenRecord,
  PasswordResetTokenRepository,
} from "../../src/domain/auth/passwordResetTokenRepository.port.ts";
import type {
  EmailChangeTokenRecord,
  EmailChangeTokenRepository,
  NewEmailChangeToken,
} from "../../src/domain/auth/emailChangeTokenRepository.port.ts";
import { FakeMailService } from "../support/fakeMailService.ts";
import { createLogger } from "../../src/shared/logging/logger.ts";
import type { PasswordHasher } from "../../src/domain/auth/passwordHasher.port.ts";

class PausingTokenService extends TokenService {
  private pause: (() => Promise<void>) | null = null;

  pauseNextOpaqueHash(): { started: Promise<void>; release: () => void } {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => markStarted = resolve);
    const released = new Promise<void>((resolve) => release = resolve);
    this.pause = async () => {
      markStarted();
      await released;
    };
    return { started, release };
  }

  override async hashOpaqueToken(token: string): Promise<string> {
    const hash = await super.hashOpaqueToken(token);
    const pause = this.pause;
    this.pause = null;
    if (pause) await pause();
    return hash;
  }
}

class PausingPasswordHasher implements PasswordHasher {
  private readonly delegate = new WebCryptoPasswordHasher();
  private pause: (() => Promise<void>) | null = null;

  pauseNextHash(): { started: Promise<void>; release: () => void } {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => markStarted = resolve);
    const released = new Promise<void>((resolve) => release = resolve);
    this.pause = async () => {
      markStarted();
      await released;
    };
    return { started, release };
  }

  async hash(password: string): Promise<string> {
    const hash = await this.delegate.hash(password);
    const pause = this.pause;
    this.pause = null;
    if (pause) await pause();
    return hash;
  }

  verify(password: string, encodedHash: string): Promise<boolean> {
    return this.delegate.verify(password, encodedHash);
  }
}

class FakeUserSessionRepository implements UserSessionRepository {
  private readonly recordsById = new Map<string, UserSessionRecord>();

  create(token: NewUserSession): UserSessionRecord {
    const record: UserSessionRecord = {
      ...token,
      issuedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      revokedAt: null,
      ipAddress: token.ipAddress ?? null,
      userAgent: token.userAgent ?? null,
    };
    this.recordsById.set(record.id, record);
    return record;
  }

  findById(id: string): UserSessionRecord | null {
    return this.recordsById.get(id) ?? null;
  }

  findByRefreshTokenHash(refreshTokenHash: string): UserSessionRecord | null {
    return [...this.recordsById.values()].find((r) => r.refreshTokenHash === refreshTokenHash) ??
      null;
  }

  rotate(
    id: string,
    currentRefreshTokenHash: string,
    nextRefreshTokenHash: string,
    lastUsedAt: string,
    nowIso: string,
    client?: SessionClientMetadata,
  ): UserSessionRecord | null {
    const record = this.recordsById.get(id);
    if (!record) return null;
    if (record.refreshTokenHash !== currentRefreshTokenHash) return null;
    if (record.revokedAt !== null || record.expiresAt < nowIso) return null;
    const updated = {
      ...record,
      refreshTokenHash: nextRefreshTokenHash,
      lastUsedAt,
      ipAddress: client?.ipAddress ?? record.ipAddress,
      userAgent: client?.userAgent ?? record.userAgent,
    };
    this.recordsById.set(id, updated);
    return updated;
  }

  revoke(id: string): boolean {
    const record = this.recordsById.get(id);
    if (!record || record.revokedAt !== null) return false;
    this.recordsById.set(id, { ...record, revokedAt: new Date().toISOString() });
    return true;
  }

  revokeOwnedSession(userId: string, id: string, revokedAt: string): boolean {
    const record = this.recordsById.get(id);
    if (!record || record.userId !== userId || record.revokedAt !== null) return false;
    this.recordsById.set(id, { ...record, revokedAt });
    return true;
  }

  revokeAllForUser(userId: string, revokedAt: string): number {
    let count = 0;
    for (const [id, record] of this.recordsById) {
      if (record.userId !== userId || record.revokedAt !== null) continue;
      this.recordsById.set(id, { ...record, revokedAt });
      count += 1;
    }
    return count;
  }

  revokeAllExcept(userId: string, keepSessionId: string, revokedAt: string): number {
    let count = 0;
    for (const [id, record] of this.recordsById) {
      if (record.userId !== userId || record.revokedAt !== null || id === keepSessionId) continue;
      this.recordsById.set(id, { ...record, revokedAt });
      count += 1;
    }
    return count;
  }

  listForUser(userId: string, nowIso: string) {
    return [...this.recordsById.values()]
      .filter((record) => record.userId === userId && record.expiresAt >= nowIso)
      .map((record) => ({
        id: record.id,
        deviceLabel: record.deviceLabel,
        remembered: record.remembered,
        createdAt: record.issuedAt,
        lastUsedAt: record.lastUsedAt,
        expiresAt: record.expiresAt,
        ipAddress: record.ipAddress,
        userAgent: record.userAgent,
        revokedAt: record.revokedAt,
      }));
  }

  activeCount(): number {
    return [...this.recordsById.values()].filter((r) => r.revokedAt === null).length;
  }

  cleanupExpiredAndRevoked(nowIso: string, revokedBeforeIso: string): number {
    let removed = 0;
    for (const [id, record] of this.recordsById) {
      const expired = record.expiresAt < nowIso;
      const oldRevoked = record.revokedAt !== null && record.revokedAt < revokedBeforeIso;
      if (expired || oldRevoked) {
        this.recordsById.delete(id);
        removed++;
      }
    }
    return removed;
  }
}

class FakeEmailVerificationTokenRepository implements EmailVerificationTokenRepository {
  private readonly records = new Map<string, EmailVerificationTokenRecord>();

  create(token: NewEmailVerificationToken): EmailVerificationTokenRecord {
    const record: EmailVerificationTokenRecord = {
      ...token,
      consumedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.records.set(record.id, record);
    return record;
  }

  invalidateActiveForUser(userId: string, consumedAt: string, nowIso: string): number {
    let count = 0;
    for (const [id, record] of this.records) {
      if (record.userId !== userId || record.consumedAt !== null || record.expiresAt < nowIso) {
        continue;
      }
      this.records.set(id, { ...record, consumedAt });
      count += 1;
    }
    return count;
  }

  findActiveByTokenHash(tokenHash: string, nowIso: string): EmailVerificationTokenRecord | null {
    return [...this.records.values()].find((record) =>
      record.tokenHash === tokenHash && record.consumedAt === null && record.expiresAt >= nowIso
    ) ?? null;
  }

  consume(id: string, consumedAt: string): boolean {
    const record = this.records.get(id);
    if (!record || record.consumedAt !== null) return false;
    this.records.set(id, { ...record, consumedAt });
    return true;
  }

  cleanupExpiredAndConsumed(nowIso: string, consumedBeforeIso: string): number {
    let count = 0;
    for (const [id, record] of this.records) {
      if (
        record.expiresAt < nowIso ||
        (record.consumedAt !== null && record.consumedAt < consumedBeforeIso)
      ) {
        this.records.delete(id);
        count += 1;
      }
    }
    return count;
  }

  list(): EmailVerificationTokenRecord[] {
    return [...this.records.values()];
  }
}

class FakePasswordResetTokenRepository implements PasswordResetTokenRepository {
  private readonly records = new Map<string, PasswordResetTokenRecord>();

  create(token: NewPasswordResetToken): PasswordResetTokenRecord {
    const record: PasswordResetTokenRecord = {
      ...token,
      consumedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.records.set(record.id, record);
    return record;
  }

  invalidateActiveForUser(userId: string, consumedAt: string, nowIso: string): number {
    let count = 0;
    for (const [id, record] of this.records) {
      if (record.userId !== userId || record.consumedAt !== null || record.expiresAt < nowIso) {
        continue;
      }
      this.records.set(id, { ...record, consumedAt });
      count += 1;
    }
    return count;
  }

  findActiveByTokenHash(tokenHash: string, nowIso: string): PasswordResetTokenRecord | null {
    return [...this.records.values()].find((record) =>
      record.tokenHash === tokenHash && record.consumedAt === null && record.expiresAt >= nowIso
    ) ?? null;
  }

  consume(id: string, consumedAt: string): boolean {
    const record = this.records.get(id);
    if (!record || record.consumedAt !== null) return false;
    this.records.set(id, { ...record, consumedAt });
    return true;
  }

  cleanupExpiredAndConsumed(nowIso: string, consumedBeforeIso: string): number {
    let count = 0;
    for (const [id, record] of this.records) {
      if (
        record.expiresAt < nowIso ||
        (record.consumedAt !== null && record.consumedAt < consumedBeforeIso)
      ) {
        this.records.delete(id);
        count += 1;
      }
    }
    return count;
  }
}

class FakeEmailChangeTokenRepository implements EmailChangeTokenRepository {
  private readonly records = new Map<string, EmailChangeTokenRecord>();

  create(token: NewEmailChangeToken): EmailChangeTokenRecord {
    const record: EmailChangeTokenRecord = {
      ...token,
      consumedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.records.set(record.id, record);
    return record;
  }

  invalidateActiveForUser(userId: string, consumedAt: string, nowIso: string): number {
    let count = 0;
    for (const [id, record] of this.records) {
      if (record.userId !== userId || record.consumedAt !== null || record.expiresAt < nowIso) {
        continue;
      }
      this.records.set(id, { ...record, consumedAt });
      count += 1;
    }
    return count;
  }

  findActiveByUserAndTokenHash(
    userId: string,
    tokenHash: string,
    nowIso: string,
  ): EmailChangeTokenRecord | null {
    return [...this.records.values()].find((record) =>
      record.userId === userId &&
      record.tokenHash === tokenHash &&
      record.consumedAt === null &&
      record.expiresAt >= nowIso
    ) ?? null;
  }

  findLatestActiveForUser(userId: string, nowIso: string): EmailChangeTokenRecord | null {
    return [...this.records.values()]
      .filter((record) =>
        record.userId === userId && record.consumedAt === null && record.expiresAt >= nowIso
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  consume(id: string, consumedAt: string): boolean {
    const record = this.records.get(id);
    if (!record || record.consumedAt !== null) return false;
    this.records.set(id, { ...record, consumedAt });
    return true;
  }

  cleanupExpiredAndConsumed(nowIso: string, consumedBeforeIso: string): number {
    let count = 0;
    for (const [id, record] of this.records) {
      if (
        record.expiresAt < nowIso ||
        (record.consumedAt !== null && record.consumedAt < consumedBeforeIso)
      ) {
        this.records.delete(id);
        count += 1;
      }
    }
    return count;
  }
}

function extractTokenFromUrl(url: string, name: string): string {
  const token = new URL(url).searchParams.get(name);
  if (!token) throw new Error(`Missing ${name} token`);
  return token;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Missing payload.");
  return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
}

function makeAuthService() {
  return new AuthService(
    new FakeUserRepository(),
    new FakeUserSessionRepository(),
    new WebCryptoPasswordHasher(),
    new TokenService({ secret: "unit-test-secret", accessTokenTtlSeconds: 900 }),
    2592000,
  );
}

function makeAdvancedAuthService(
  options: Partial<{
    nowMs: number;
    sessionDefaultTtlMs: number;
    sessionRememberedTtlMs: number;
    emailVerificationTtlMs: number;
    passwordResetTtlMs: number;
    emailChangeTtlMs: number;
    tokenService: TokenService;
    passwordHasher: PasswordHasher;
  }> = {},
) {
  const users = new FakeUserRepository();
  const userSessions = new FakeUserSessionRepository();
  const emailVerificationTokens = new FakeEmailVerificationTokenRepository();
  const passwordResetTokens = new FakePasswordResetTokenRepository();
  const emailChangeTokens = new FakeEmailChangeTokenRepository();
  const mailService = new FakeMailService();
  let nowMs = options.nowMs ?? Date.UTC(2026, 0, 1, 12, 0, 0);
  const tokenService = options.tokenService ??
    new TokenService({ secret: "unit-test-secret", accessTokenTtlSeconds: 900 });
  const passwordHasher = options.passwordHasher ?? new WebCryptoPasswordHasher();
  const auth = new AuthService({
    users,
    userSessions,
    emailVerificationTokens,
    passwordResetTokens,
    emailChangeTokens,
    passwordHasher,
    tokenService,
    transactions: {
      run<T>(fn: () => T): T {
        return fn();
      },
    },
    mailService,
    logger: createLogger("error", "auth-service-test"),
    sessionDefaultTtlMs: options.sessionDefaultTtlMs ?? 86_400_000,
    sessionRememberedTtlMs: options.sessionRememberedTtlMs ?? 2_592_000_000,
    emailVerificationTtlMs: options.emailVerificationTtlMs ?? 3_600_000,
    passwordResetTtlMs: options.passwordResetTtlMs ?? 1_800_000,
    emailChangeTtlMs: options.emailChangeTtlMs ?? 3_600_000,
    publicBaseUrl: "https://chat.example.com",
    now: () => nowMs,
  });

  return {
    auth,
    users,
    userSessions,
    emailVerificationTokens,
    passwordResetTokens,
    emailChangeTokens,
    mailService,
    tokenService,
    advance(ms: number) {
      nowMs += ms;
    },
  };
}

Deno.test("AuthService.register creates a user and issues a session", async () => {
  const auth = makeAuthService();
  const result = await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });

  assertEquals(result.profile.username, "alice");
  assert(result.accessToken.split(".").length === 3);
  assert(result.refreshToken.length > 0);
});

Deno.test("AuthService.register rejects a duplicate email", async () => {
  const auth = makeAuthService();
  await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });

  await assertRejects(
    () =>
      auth.register({
        username: "alice2",
        email: "alice@example.com",
        password: "another-password",
        displayName: "Alice Two",
      }),
    ConflictError,
  );
});

Deno.test("AuthService.register rejects a duplicate username", async () => {
  const auth = makeAuthService();
  await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });

  await assertRejects(
    () =>
      auth.register({
        username: "alice",
        email: "someone-else@example.com",
        password: "another-password",
        displayName: "Someone Else",
      }),
    ConflictError,
  );
});

Deno.test("AuthService.login succeeds with the correct password", async () => {
  const auth = makeAuthService();
  await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });

  const result = await auth.login({
    email: "alice@example.com",
    password: "correct-horse-battery",
  });
  assertEquals(result.profile.username, "alice");
});

Deno.test("AuthService.login works with username", async () => {
  const auth = makeAuthService();
  await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });

  const result = await auth.login({
    email: "alice",
    password: "correct-horse-battery",
  });
  assertEquals(result.profile.username, "alice");
});

Deno.test("AuthService.login rejects a wrong password", async () => {
  const auth = makeAuthService();
  await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });

  await assertRejects(
    () => auth.login({ email: "alice@example.com", password: "wrong-password" }),
    UnauthorizedError,
  );
});

Deno.test("AuthService.login rejects an unknown email", async () => {
  const auth = makeAuthService();
  await assertRejects(
    () => auth.login({ email: "ghost@example.com", password: "whatever" }),
    UnauthorizedError,
  );
});

Deno.test("AuthService.refresh rotates the token: the old one stops working, the new one works", async () => {
  const auth = makeAuthService();
  const { refreshToken } = await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });

  const rotated = await auth.refresh(refreshToken);
  assert(rotated.refreshToken !== refreshToken);

  await assertRejects(() => auth.refresh(refreshToken), UnauthorizedError);

  const rotatedAgain = await auth.refresh(rotated.refreshToken);
  assert(rotatedAgain.accessToken.split(".").length === 3);
});

Deno.test("AuthService.refresh: two concurrent uses of the same token mint at most one session", async () => {
  const sessions = new FakeUserSessionRepository();
  const auth = new AuthService(
    new FakeUserRepository(),
    sessions,
    new WebCryptoPasswordHasher(),
    new TokenService({ secret: "unit-test-secret", accessTokenTtlSeconds: 900 }),
    2592000,
  );
  const { refreshToken } = await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });

  const outcomes = await Promise.allSettled([
    auth.refresh(refreshToken),
    auth.refresh(refreshToken),
  ]);
  const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
  const rejected = outcomes.filter((o) => o.status === "rejected");

  assertEquals(fulfilled.length, 1, "exactly one concurrent refresh must succeed");
  assertEquals(rejected.length, 1, "the losing concurrent refresh must be rejected");
  // The consumed parent plus a single descendant leaves exactly one active session.
  assertEquals(sessions.activeCount(), 1);
});

Deno.test("AuthService.refresh rejects a garbage token", async () => {
  const auth = makeAuthService();
  await assertRejects(() => auth.refresh("not-a-real-token"), UnauthorizedError);
});

Deno.test("AuthService.logout revokes the refresh token so it can no longer be used", async () => {
  const auth = makeAuthService();
  const { refreshToken } = await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });

  await auth.logout(refreshToken);
  await assertRejects(() => auth.refresh(refreshToken), UnauthorizedError);
});

Deno.test("AuthService.cleanupExpiredAndRevoked delegates to the session repository", async () => {
  const auth = makeAuthService();
  const created = await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });
  assert(created.refreshToken.length > 0);

  const removed = auth.cleanupExpiredAndRevoked(
    new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString(),
    new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString(),
  );
  assertEquals(removed, 1);
});

Deno.test("AuthService.login defaults to a non-remembered session and remembered sessions use the remembered TTL", async () => {
  const { auth, userSessions } = makeAdvancedAuthService({
    nowMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    sessionDefaultTtlMs: 60_000,
    sessionRememberedTtlMs: 300_000,
  });
  await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });

  const defaultSession = await auth.login({
    email: "alice@example.com",
    password: "correct-horse-battery",
  });
  const defaultPayload = decodeJwtPayload(defaultSession.accessToken);
  const defaultRecord = userSessions.findById(String(defaultPayload.sid));
  assertEquals(defaultRecord?.remembered, false);
  assertEquals(defaultRecord?.expiresAt, "2026-01-01T12:01:00.000Z");

  const rememberedSession = await auth.login({
    email: "alice@example.com",
    password: "correct-horse-battery",
    rememberMe: true,
  });
  const rememberedPayload = decodeJwtPayload(rememberedSession.accessToken);
  const rememberedRecord = userSessions.findById(String(rememberedPayload.sid));
  assertEquals(rememberedRecord?.remembered, true);
  assertEquals(rememberedRecord?.expiresAt, "2026-01-01T12:05:00.000Z");
});

Deno.test("AuthService.refresh preserves the session id, device label, remembered flag, and absolute expiry", async () => {
  const { auth, userSessions, advance } = makeAdvancedAuthService({
    nowMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    sessionDefaultTtlMs: 60_000,
    sessionRememberedTtlMs: 300_000,
  });
  const login = await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
    rememberMe: true,
    deviceLabel: "Laptop",
  });
  const beforePayload = decodeJwtPayload(login.accessToken);
  const beforeRecord = userSessions.findById(String(beforePayload.sid));

  advance(120_000);
  const rotated = await auth.refresh(login.refreshToken);
  const afterPayload = decodeJwtPayload(rotated.accessToken);
  const afterRecord = userSessions.findById(String(afterPayload.sid));

  assertEquals(afterPayload.sid, beforePayload.sid);
  assertEquals(afterRecord?.deviceLabel, "Laptop");
  assertEquals(afterRecord?.remembered, true);
  assertEquals(afterRecord?.expiresAt, beforeRecord?.expiresAt);
  assertEquals(afterRecord?.lastUsedAt, "2026-01-01T12:02:00.000Z");
});

Deno.test("AuthService.refresh preserves remembered absolute expiry across repeated rotation", async () => {
  const { auth, userSessions, advance } = makeAdvancedAuthService({
    nowMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    sessionRememberedTtlMs: 300_000,
  });
  let session = await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
    rememberMe: true,
  });
  const sessionId = String(decodeJwtPayload(session.accessToken).sid);
  const absoluteExpiry = userSessions.findById(sessionId)?.expiresAt;

  for (const elapsed of [60_000, 60_000, 179_000]) {
    advance(elapsed);
    session = await auth.refresh(session.refreshToken);
    assertEquals(userSessions.findById(sessionId)?.expiresAt, absoluteExpiry);
  }
  advance(1_001);
  await assertRejects(() => auth.refresh(session.refreshToken), UnauthorizedError);
});

Deno.test("AuthService.register persists only the verification token hash and verification completion is single-use", async () => {
  const { auth, users, emailVerificationTokens, mailService } = makeAdvancedAuthService();
  await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });

  const mail = mailService.latest("verification");
  const rawToken = extractTokenFromUrl(mail?.input.verificationUrl ?? "", "verify_email");
  const stored = emailVerificationTokens.list()[0];
  assertEquals(stored?.tokenHash === rawToken, false);

  const outcomes = await Promise.allSettled([
    auth.verifyEmail(rawToken),
    auth.verifyEmail(rawToken),
  ]);
  assertEquals(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assertEquals(outcomes.filter((result) => result.status === "rejected").length, 1);
  assertEquals(users.findByEmail("alice@example.com")?.emailVerifiedAt !== null, true);
});

Deno.test("AuthService.resendVerification invalidates the previous active verification token", async () => {
  const { auth, emailVerificationTokens, mailService } = makeAdvancedAuthService();
  await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });
  const firstToken = extractTokenFromUrl(
    mailService.latest("verification")?.input.verificationUrl ?? "",
    "verify_email",
  );

  const firstSession = await auth.login({
    email: "alice@example.com",
    password: "correct-horse-battery",
  });
  const sessionPayload = decodeJwtPayload(firstSession.accessToken);
  const resendResult = await auth.resendVerification(String(sessionPayload.sub));
  assertEquals(resendResult.alreadyVerified, false);
  assertEquals(resendResult.sent, true);

  const secondToken = extractTokenFromUrl(
    mailService.latest("verification")?.input.verificationUrl ?? "",
    "verify_email",
  );
  assertEquals(secondToken === firstToken, false);
  assertEquals(
    emailVerificationTokens.list().filter((record) => record.consumedAt === null).length,
    1,
  );
  await assertRejects(() => auth.verifyEmail(firstToken), UnauthorizedError);
});

Deno.test("AuthService.resendVerification rechecks verification state after token hashing", async () => {
  const tokenService = new PausingTokenService({
    secret: "unit-test-secret",
    accessTokenTtlSeconds: 900,
  });
  const { auth, users, emailVerificationTokens, mailService } = makeAdvancedAuthService({
    tokenService,
  });
  const registered = await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });
  const initialDeliveries = mailService.deliveries.length;
  const gate = tokenService.pauseNextOpaqueHash();
  const resend = auth.resendVerification(registered.profile.id);
  await gate.started;
  users.markEmailVerified(registered.profile.id, "2026-01-01T12:00:01.000Z");
  gate.release();

  assertEquals(await resend, { alreadyVerified: true, sent: false });
  assertEquals(mailService.deliveries.length, initialDeliveries);
  assertEquals(
    emailVerificationTokens.list().filter((record) => record.consumedAt === null).length,
    1,
  );
});

Deno.test("AuthService.changePassword cannot overwrite a concurrent password update", async () => {
  const passwordHasher = new PausingPasswordHasher();
  const { auth, users } = makeAdvancedAuthService({ passwordHasher });
  const registered = await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });
  const sessionId = String(decodeJwtPayload(registered.accessToken).sid);
  const gate = passwordHasher.pauseNextHash();
  const change = auth.changePassword(
    registered.profile.id,
    sessionId,
    "correct-horse-battery",
    "stale-password-change",
  );
  await gate.started;
  const resetHash = await new WebCryptoPasswordHasher().hash("concurrent-reset-password");
  users.updatePasswordHash(registered.profile.id, resetHash);
  gate.release();

  await assertRejects(() => change, UnauthorizedError);
  const login = await auth.login({
    email: "alice@example.com",
    password: "concurrent-reset-password",
  });
  assertEquals(typeof login.refreshToken, "string");
});

Deno.test("AuthService.listSessions and revokeSession use the trusted current session id from the access token", async () => {
  const { auth } = makeAdvancedAuthService();
  const first = await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });
  const second = await auth.login({
    email: "alice@example.com",
    password: "correct-horse-battery",
    deviceLabel: "Phone",
  });
  const currentSessionId = String(decodeJwtPayload(second.accessToken).sid);
  const otherSessionId = String(decodeJwtPayload(first.accessToken).sid);

  const sessions = auth.listSessions(
    String(decodeJwtPayload(second.accessToken).sub),
    currentSessionId,
  );
  assertEquals(sessions.length, 2);
  assertEquals(
    sessions.some((session) => session.id === currentSessionId && session.current),
    true,
  );
  assertEquals(sessions.some((session) => session.id === otherSessionId && session.current), false);

  const revoked = auth.revokeSession(
    String(decodeJwtPayload(second.accessToken).sub),
    currentSessionId,
    otherSessionId,
  );
  assertEquals(revoked.revokedCurrent, false);
  const afterRevoke = auth.listSessions(
    String(decodeJwtPayload(second.accessToken).sub),
    currentSessionId,
  );
  // The revoked session stays listed as history, flagged via revokedAt.
  assertEquals(afterRevoke.length, 2);
  assertEquals(afterRevoke.find((s) => s.id === otherSessionId)?.revokedAt !== null, true);
  assertEquals(afterRevoke.find((s) => s.id === currentSessionId)?.revokedAt, null);
});

Deno.test("AuthService captures session client metadata at login/register, updates it on refresh, and sanitizes the user-agent", async () => {
  const { auth } = makeAdvancedAuthService();
  await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
    clientIp: "203.0.113.9",
    userAgent: "Mozilla/5.0\u0007(X11; Linux) Firefox/128",
  });
  const login = await auth.login({
    email: "alice@example.com",
    password: "correct-horse-battery",
    clientIp: "198.51.100.7",
    userAgent: "A".repeat(500),
  });
  const userId = String(decodeJwtPayload(login.accessToken).sub);
  const currentSessionId = String(decodeJwtPayload(login.accessToken).sid);

  const sessions = auth.listSessions(userId, currentSessionId);
  const registered = sessions.find((s) => s.id !== currentSessionId)!;
  const current = sessions.find((s) => s.id === currentSessionId)!;
  // Control characters are stripped, and an oversized user-agent is bounded.
  assertEquals(registered.ipAddress, "203.0.113.9");
  assertEquals(registered.userAgent, "Mozilla/5.0 (X11; Linux) Firefox/128");
  assertEquals(current.ipAddress, "198.51.100.7");
  assertEquals(current.userAgent?.length, 400);

  // Refresh from a new network updates the stored client metadata.
  await auth.refresh(login.refreshToken, {
    clientIp: "192.0.2.44",
    userAgent: "Refreshed-Agent/1.0",
  });
  const refreshed = auth.listSessions(userId, currentSessionId)
    .find((s) => s.id === currentSessionId)!;
  assertEquals(refreshed.ipAddress, "192.0.2.44");
  assertEquals(refreshed.userAgent, "Refreshed-Agent/1.0");

  // Sessions created without client context keep null metadata.
  const anonymous = await auth.login({
    email: "alice@example.com",
    password: "correct-horse-battery",
  });
  const anonymousId = String(decodeJwtPayload(anonymous.accessToken).sid);
  const anonymousSession = auth.listSessions(userId, anonymousId)
    .find((s) => s.id === anonymousId)!;
  assertEquals(anonymousSession.ipAddress, null);
  assertEquals(anonymousSession.userAgent, null);
});

Deno.test("AuthService.completePasswordReset revokes all sessions and sends a password-changed notice", async () => {
  const { auth, userSessions, mailService } = makeAdvancedAuthService();
  await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });
  await auth.login({
    email: "alice@example.com",
    password: "correct-horse-battery",
    deviceLabel: "Phone",
  });

  await auth.requestPasswordReset("alice@example.com");
  const rawToken = extractTokenFromUrl(
    mailService.latest("password_reset")?.input.resetUrl ?? "",
    "reset_password",
  );
  await auth.completePasswordReset(rawToken, "new-correct-horse-battery");

  assertEquals(userSessions.activeCount(), 0);
  assertEquals(mailService.latest("password_changed_notice")?.input.toEmail, "alice@example.com");
  await assertRejects(
    () => auth.login({ email: "alice@example.com", password: "correct-horse-battery" }),
    UnauthorizedError,
  );
  const relogin = await auth.login({
    email: "alice@example.com",
    password: "new-correct-horse-battery",
  });
  assertEquals(typeof relogin.refreshToken, "string");
});

Deno.test("AuthService.requestPasswordReset does not expose mail-provider latency", async () => {
  const { auth, mailService } = makeAdvancedAuthService();
  await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });

  let releaseDelivery!: () => void;
  const deliveryPending = new Promise<void>((resolve) => releaseDelivery = resolve);
  mailService.sendPasswordResetEmail = (input) => {
    mailService.deliveries.push({ purpose: "password_reset", input });
    return deliveryPending;
  };

  const request = auth.requestPasswordReset("alice@example.com");
  const resolvedWithoutProvider = await Promise.race([
    request.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
  ]);
  assertEquals(resolvedWithoutProvider, true);
  releaseDelivery();
  await request;
});

Deno.test("AuthService.completeEmailChange keeps the email pending until token completion, then verifies the new address and revokes other sessions", async () => {
  const { auth, users, userSessions, mailService } = makeAdvancedAuthService();
  const first = await auth.register({
    username: "alice",
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  });
  await auth.verifyEmail(
    extractTokenFromUrl(
      mailService.latest("verification")?.input.verificationUrl ?? "",
      "verify_email",
    ),
  );
  const second = await auth.login({
    email: "alice@example.com",
    password: "correct-horse-battery",
    deviceLabel: "Phone",
  });
  const currentSessionId = String(decodeJwtPayload(second.accessToken).sid);
  const userId = String(decodeJwtPayload(second.accessToken).sub);
  const firstSessionId = String(decodeJwtPayload(first.accessToken).sid);

  await auth.startEmailChange(userId, "correct-horse-battery", "alice.new@example.com");
  assertEquals(users.findById(userId)?.email, "alice@example.com");

  const rawToken = extractTokenFromUrl(
    mailService.latest("email_change_verification")?.input.verificationUrl ?? "",
    "change_email",
  );
  const result = await auth.completeEmailChange(userId, currentSessionId, rawToken);

  assertEquals(result.email, "alice.new@example.com");
  assertEquals(users.findById(userId)?.email, "alice.new@example.com");
  assertEquals(users.findById(userId)?.emailVerifiedAt !== null, true);
  assertEquals(
    userSessions.listForUser(userId, "9999-12-31T00:00:00.000Z").some((session) =>
      session.id === firstSessionId && session.revokedAt === null
    ),
    false,
  );
  assertEquals(mailService.latest("email_changed_notice")?.input.toEmail, "alice@example.com");
});
