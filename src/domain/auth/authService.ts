import type { TransactionManager } from "../../shared/transactions/transactionManager.ts";
import type { Logger } from "../../shared/logging/logger.ts";
import type { UserRepository } from "../users/userRepository.port.ts";
import type { UserSessionRepository } from "./userSessionRepository.port.ts";
import type { PasswordHasher } from "./passwordHasher.port.ts";
import type { TokenService } from "./tokenService.ts";
import type { MailService } from "./mailService.port.ts";
import type { EmailVerificationTokenRepository } from "./emailVerificationTokenRepository.port.ts";
import type { PasswordResetTokenRepository } from "./passwordResetTokenRepository.port.ts";
import type { EmailChangeTokenRepository } from "./emailChangeTokenRepository.port.ts";
import type { AccountSecurityStatus, SessionSummary } from "./accountSecurity.entity.ts";
import { type Profile, toProfile, type User } from "../users/user.entity.ts";
import { ConflictError } from "../../shared/errors/conflictError.ts";
import { UnauthorizedError } from "../../shared/errors/unauthorizedError.ts";
import { NotFoundError } from "../../shared/errors/notFoundError.ts";
import { generateId } from "../../shared/id.ts";
import { normalizeEmailIdentity, sanitizeDeviceLabel, sanitizeUserAgent } from "./emailAddress.ts";
import {
  AccountDisabledError,
  ForcePasswordResetRequiredError,
} from "../administration/administrationErrors.ts";

const NOOP_LOGGER: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
};

const identityTransactions: TransactionManager = {
  run<T>(fn: () => T): T {
    return fn();
  },
};

const noopMailService: MailService = {
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendPasswordChangedNotice: () => Promise.resolve(),
  sendEmailChangeVerificationEmail: () => Promise.resolve(),
  sendEmailChangedNotice: () => Promise.resolve(),
};

function makeNoopTokenRepository<TRecord extends { id: string }>(): {
  create(record: TRecord): TRecord;
  invalidateActiveForUser(): number;
  findActiveByTokenHash(): TRecord | null;
  consume(): boolean;
  cleanupExpiredAndConsumed(): number;
} {
  return {
    create(record) {
      return record;
    },
    invalidateActiveForUser() {
      return 0;
    },
    findActiveByTokenHash() {
      return null;
    },
    consume() {
      return false;
    },
    cleanupExpiredAndConsumed() {
      return 0;
    },
  };
}

function makeNoopEmailChangeTokenRepository(): EmailChangeTokenRepository {
  return {
    create(token) {
      return { ...token, consumedAt: null, createdAt: new Date().toISOString() };
    },
    invalidateActiveForUser() {
      return 0;
    },
    findActiveByUserAndTokenHash() {
      return null;
    },
    findLatestActiveForUser() {
      return null;
    },
    consume() {
      return false;
    },
    cleanupExpiredAndConsumed() {
      return 0;
    },
  };
}

export interface AuthResult {
  readonly profile: Profile;
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface RegisterInput {
  readonly username: string;
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly rememberMe?: boolean;
  readonly deviceLabel?: string | null;
  /** Resolved by the transport's trusted-proxy policy — never a raw client header. */
  readonly clientIp?: string | null;
  readonly userAgent?: string | null;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly rememberMe?: boolean;
  readonly deviceLabel?: string | null;
  /** Resolved by the transport's trusted-proxy policy — never a raw client header. */
  readonly clientIp?: string | null;
  readonly userAgent?: string | null;
}

export interface AuthServiceOptions {
  readonly users: UserRepository;
  readonly userSessions: UserSessionRepository;
  readonly emailVerificationTokens: EmailVerificationTokenRepository;
  readonly passwordResetTokens: PasswordResetTokenRepository;
  readonly emailChangeTokens: EmailChangeTokenRepository;
  readonly passwordHasher: PasswordHasher;
  readonly tokenService: TokenService;
  readonly transactions: TransactionManager;
  readonly mailService: MailService;
  readonly logger: Logger;
  readonly sessionDefaultTtlMs: number;
  readonly sessionRememberedTtlMs: number;
  readonly emailVerificationTtlMs: number;
  readonly passwordResetTtlMs: number;
  readonly emailChangeTtlMs: number;
  readonly publicBaseUrl: string;
  readonly now?: () => number;
}

export class AuthService {
  private readonly now: () => number;
  private readonly options: AuthServiceOptions;

  constructor(options: AuthServiceOptions);
  constructor(
    users: UserRepository,
    userSessions: UserSessionRepository,
    passwordHasher: PasswordHasher,
    tokenService: TokenService,
    refreshTokenTtlSeconds: number,
  );
  constructor(
    optionsOrUsers: AuthServiceOptions | UserRepository,
    userSessions?: UserSessionRepository,
    passwordHasher?: PasswordHasher,
    tokenService?: TokenService,
    refreshTokenTtlSeconds?: number,
  ) {
    if (
      userSessions && passwordHasher && tokenService && typeof refreshTokenTtlSeconds === "number"
    ) {
      this.options = {
        users: optionsOrUsers as UserRepository,
        userSessions,
        emailVerificationTokens:
          makeNoopTokenRepository() as unknown as EmailVerificationTokenRepository,
        passwordResetTokens: makeNoopTokenRepository() as unknown as PasswordResetTokenRepository,
        emailChangeTokens: makeNoopEmailChangeTokenRepository(),
        passwordHasher,
        tokenService,
        transactions: identityTransactions,
        mailService: noopMailService,
        logger: NOOP_LOGGER,
        sessionDefaultTtlMs: refreshTokenTtlSeconds * 1000,
        sessionRememberedTtlMs: refreshTokenTtlSeconds * 1000,
        emailVerificationTtlMs: 3_600_000,
        passwordResetTtlMs: 1_800_000,
        emailChangeTtlMs: 3_600_000,
        publicBaseUrl: "http://localhost:8080",
      };
    } else {
      this.options = optionsOrUsers as AuthServiceOptions;
    }
    this.now = this.options.now ?? (() => Date.now());
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const email = normalizeEmailIdentity(input.email);
    if (this.options.users.findByEmail(email)) {
      throw new ConflictError("An account with this email already exists.");
    }
    if (this.options.users.findByUsername(input.username)) {
      throw new ConflictError("This username is already taken.");
    }

    const passwordHash = await this.options.passwordHasher.hash(input.password);
    const userId = generateId();
    const rememberMe = input.rememberMe ?? false;
    const deviceLabel = sanitizeDeviceLabel(input.deviceLabel ?? null);
    const sessionDraft = await this.prepareSessionDraft(rememberMe, deviceLabel);
    const verificationDraft = await this.prepareOpaqueToken(this.options.emailVerificationTtlMs);

    const user = this.options.transactions.run(() => {
      const created = this.options.users.create({
        id: userId,
        username: input.username,
        displayName: input.displayName,
        email,
        passwordHash,
      });
      this.options.userSessions.create({
        id: sessionDraft.sessionId,
        userId,
        refreshTokenHash: sessionDraft.refreshTokenHash,
        deviceLabel,
        remembered: rememberMe,
        expiresAt: sessionDraft.expiresAt,
        ipAddress: input.clientIp ?? null,
        userAgent: sanitizeUserAgent(input.userAgent ?? null),
      });
      this.options.emailVerificationTokens.create({
        id: verificationDraft.id,
        userId,
        tokenHash: verificationDraft.tokenHash,
        expiresAt: verificationDraft.expiresAt,
      });
      return created;
    });

    await this.trySendVerificationEmail(user, verificationDraft.rawToken);
    return await this.buildAuthResult(user, sessionDraft);
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const identity = input.email.trim();
    const user = identity.includes("@")
      ? this.options.users.findByEmail(normalizeEmailIdentity(identity))
      : this.options.users.findByUsername(identity);
    const valid = user
      ? await this.options.passwordHasher.verify(input.password, user.passwordHash)
      : false;
    if (!user || !valid) {
      throw new UnauthorizedError("Invalid email, username, or password.");
    }
    if (user.accountDisabledAt) throw new AccountDisabledError("This account is disabled.");
    if (user.mustResetPassword) {
      throw new ForcePasswordResetRequiredError("A password reset is required.");
    }

    const draft = await this.prepareSessionDraft(
      input.rememberMe ?? false,
      sanitizeDeviceLabel(input.deviceLabel ?? null),
    );
    this.options.userSessions.create({
      id: draft.sessionId,
      userId: user.id,
      refreshTokenHash: draft.refreshTokenHash,
      deviceLabel: draft.deviceLabel,
      remembered: draft.remembered,
      expiresAt: draft.expiresAt,
      ipAddress: input.clientIp ?? null,
      userAgent: sanitizeUserAgent(input.userAgent ?? null),
    });
    return await this.buildAuthResult(user, draft);
  }

  async refresh(
    refreshToken: string,
    client?: { clientIp?: string | null; userAgent?: string | null },
  ): Promise<AuthResult> {
    const refreshTokenHash = await this.options.tokenService.hashRefreshToken(refreshToken);
    const record = this.options.userSessions.findByRefreshTokenHash(refreshTokenHash);
    const nowIso = this.nowIso();
    if (!record || record.revokedAt || record.expiresAt < nowIso) {
      throw new UnauthorizedError("Refresh token is invalid, expired, or revoked.");
    }

    const user = this.options.users.findById(record.userId);
    if (!user) {
      throw new UnauthorizedError("Refresh token is invalid, expired, or revoked.");
    }

    const nextRefreshToken = this.options.tokenService.generateRefreshToken();
    const nextRefreshTokenHash = await this.options.tokenService.hashRefreshToken(nextRefreshToken);
    const rotated = this.options.userSessions.rotate(
      record.id,
      refreshTokenHash,
      nextRefreshTokenHash,
      nowIso,
      nowIso,
      {
        ipAddress: client?.clientIp ?? null,
        userAgent: sanitizeUserAgent(client?.userAgent ?? null),
      },
    );
    if (!rotated) {
      throw new UnauthorizedError("Refresh token is invalid, expired, or revoked.");
    }

    const accessToken = await this.options.tokenService.signAccessToken(
      user.id,
      user.username,
      record.id,
    );
    return { profile: toProfile(user), accessToken, refreshToken: nextRefreshToken };
  }

  async logout(userIdOrRefreshToken: string, refreshToken?: string): Promise<void> {
    const userId = refreshToken === undefined ? null : userIdOrRefreshToken;
    const token = refreshToken ?? userIdOrRefreshToken;
    const refreshTokenHash = await this.options.tokenService.hashRefreshToken(token);
    const record = this.options.userSessions.findByRefreshTokenHash(refreshTokenHash);
    if (!record || record.revokedAt) return;
    if (userId === null) {
      this.options.userSessions.revoke(record.id);
      return;
    }
    if (record.userId === userId) {
      this.options.userSessions.revokeOwnedSession(userId, record.id, this.nowIso());
    }
  }

  listSessions(userId: string, currentSessionId: string): SessionSummary[] {
    return this.options.userSessions.listForUser(userId, this.nowIso()).map((session) => ({
      ...session,
      current: session.id === currentSessionId,
    }));
  }

  revokeSession(
    userId: string,
    currentSessionId: string,
    targetSessionId: string,
  ): { revokedCurrent: boolean } {
    const revoked = this.options.userSessions.revokeOwnedSession(
      userId,
      targetSessionId,
      this.nowIso(),
    );
    if (!revoked) {
      throw new NotFoundError("Session not found.", { sessionId: targetSessionId });
    }
    return { revokedCurrent: targetSessionId === currentSessionId };
  }

  revokeOtherSessions(userId: string, currentSessionId: string): number {
    return this.options.userSessions.revokeAllExcept(userId, currentSessionId, this.nowIso());
  }

  getAccountSecurityStatus(userId: string): AccountSecurityStatus {
    const user = this.options.users.findById(userId);
    if (!user) throw new NotFoundError("User not found.", { userId });
    const pendingEmail =
      this.options.emailChangeTokens.findLatestActiveForUser(userId, this.nowIso())
        ?.newEmail ?? null;
    return {
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      pendingEmail,
    };
  }

  async resendVerification(userId: string): Promise<{ alreadyVerified: boolean; sent: boolean }> {
    const user = this.options.users.findById(userId);
    if (!user) throw new NotFoundError("User not found.", { userId });
    if (user.emailVerifiedAt) {
      return { alreadyVerified: true, sent: false };
    }

    const token = await this.prepareOpaqueToken(this.options.emailVerificationTtlMs);
    const issueForUser = this.options.transactions.run(() => {
      const nowIso = this.nowIso();
      const currentUser = this.options.users.findById(userId);
      if (!currentUser) throw new NotFoundError("User not found.", { userId });
      if (currentUser.emailVerifiedAt) return null;
      this.options.emailVerificationTokens.invalidateActiveForUser(userId, nowIso, nowIso);
      this.options.emailVerificationTokens.create({
        id: token.id,
        userId,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
      });
      return currentUser;
    });
    if (!issueForUser) return { alreadyVerified: true, sent: false };
    const sent = await this.trySendVerificationEmail(issueForUser, token.rawToken);
    return { alreadyVerified: false, sent };
  }

  async verifyEmail(token: string): Promise<{ userId: string; emailVerifiedAt: string }> {
    const tokenHash = await this.options.tokenService.hashOpaqueToken(token);
    const nowIso = this.nowIso();

    return this.options.transactions.run(() => {
      const record = this.options.emailVerificationTokens.findActiveByTokenHash(tokenHash, nowIso);
      if (!record) {
        throw new UnauthorizedError("Verification token is invalid or expired.");
      }
      if (!this.options.emailVerificationTokens.consume(record.id, nowIso)) {
        throw new UnauthorizedError("Verification token is invalid or expired.");
      }
      this.options.users.markEmailVerified(record.userId, nowIso);
      this.options.emailVerificationTokens.invalidateActiveForUser(record.userId, nowIso, nowIso);
      return { userId: record.userId, emailVerifiedAt: nowIso };
    });
  }

  async requestPasswordReset(emailInput: string): Promise<void> {
    const email = normalizeEmailIdentity(emailInput);
    const user = this.options.users.findByEmail(email);
    // Generate and hash an indistinguishable candidate on both paths. Provider delivery is
    // detached below so its network latency cannot become an account-existence oracle.
    const token = await this.prepareOpaqueToken(this.options.passwordResetTtlMs);

    if (!user) return;

    this.options.transactions.run(() => {
      const nowIso = this.nowIso();
      this.options.passwordResetTokens.invalidateActiveForUser(user.id, nowIso, nowIso);
      this.options.passwordResetTokens.create({
        id: token.id,
        userId: user.id,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
      });
    });

    void this.trySendPasswordResetEmail(user, token.rawToken);
  }

  async completePasswordReset(token: string, newPassword: string): Promise<void> {
    const tokenHash = await this.options.tokenService.hashOpaqueToken(token);
    const newPasswordHash = await this.options.passwordHasher.hash(newPassword);
    const nowIso = this.nowIso();

    const completed = this.options.transactions.run(() => {
      const record = this.options.passwordResetTokens.findActiveByTokenHash(tokenHash, nowIso);
      if (!record) {
        throw new UnauthorizedError("Password reset token is invalid or expired.");
      }
      if (!this.options.passwordResetTokens.consume(record.id, nowIso)) {
        throw new UnauthorizedError("Password reset token is invalid or expired.");
      }
      const user = this.options.users.findById(record.userId);
      if (!user) throw new NotFoundError("User not found.", { userId: record.userId });
      this.options.users.updatePasswordHash(record.userId, newPasswordHash);
      this.options.users.clearForcedPasswordReset(record.userId);
      this.options.userSessions.revokeAllForUser(record.userId, nowIso);
      this.options.passwordResetTokens.invalidateActiveForUser(record.userId, nowIso, nowIso);
      this.options.emailChangeTokens.invalidateActiveForUser(record.userId, nowIso, nowIso);
      return { email: user.email, displayName: user.displayName };
    });

    await this.trySendPasswordChangedNotice(completed.email, completed.displayName);
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = this.options.users.findById(userId);
    if (!user) {
      throw new UnauthorizedError("Invalid email or password.");
    }
    const valid = await this.options.passwordHasher.verify(currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedError("Invalid email or password.");
    }
    const newHash = await this.options.passwordHasher.hash(newPassword);
    const nowIso = this.nowIso();

    this.options.transactions.run(() => {
      const updated = this.options.users.updatePasswordHashIfCurrent(
        userId,
        user.passwordHash,
        newHash,
      );
      if (!updated) {
        throw new UnauthorizedError("The current password changed during this request.");
      }
      this.options.users.clearForcedPasswordReset(userId);
      this.options.userSessions.revokeAllExcept(userId, currentSessionId, nowIso);
      this.options.emailChangeTokens.invalidateActiveForUser(userId, nowIso, nowIso);
    });

    await this.trySendPasswordChangedNotice(user.email, user.displayName);
  }

  async startEmailChange(
    userId: string,
    currentPassword: string,
    newEmailInput: string,
  ): Promise<void> {
    const user = this.options.users.findById(userId);
    if (!user) {
      throw new UnauthorizedError("Invalid email or password.");
    }
    const valid = await this.options.passwordHasher.verify(currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedError("Invalid email or password.");
    }

    const newEmail = normalizeEmailIdentity(newEmailInput);
    if (newEmail === user.email) {
      throw new ConflictError("The new email address must be different.");
    }
    const existing = this.options.users.findByEmail(newEmail);
    if (existing && existing.id !== userId) {
      throw new ConflictError("An account with this email already exists.");
    }

    const token = await this.prepareOpaqueToken(this.options.emailChangeTtlMs);
    this.options.transactions.run(() => {
      const nowIso = this.nowIso();
      this.options.emailChangeTokens.invalidateActiveForUser(userId, nowIso, nowIso);
      this.options.emailChangeTokens.create({
        id: token.id,
        userId,
        newEmail,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
      });
    });

    try {
      await this.options.mailService.sendEmailChangeVerificationEmail({
        toEmail: newEmail,
        displayName: user.displayName,
        verificationUrl: this.buildPublicUrl("change_email", token.rawToken),
      });
    } catch (error) {
      this.options.logger.error("email change verification delivery failed", {
        userId,
        toEmail: newEmail,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async completeEmailChange(
    userId: string,
    currentSessionId: string,
    token: string,
  ): Promise<{ email: string; emailVerifiedAt: string }> {
    const tokenHash = await this.options.tokenService.hashOpaqueToken(token);
    const nowIso = this.nowIso();

    const completed = this.options.transactions.run(() => {
      const record = this.options.emailChangeTokens.findActiveByUserAndTokenHash(
        userId,
        tokenHash,
        nowIso,
      );
      if (!record) {
        throw new UnauthorizedError("Email change token is invalid or expired.");
      }
      if (!this.options.emailChangeTokens.consume(record.id, nowIso)) {
        throw new UnauthorizedError("Email change token is invalid or expired.");
      }

      const user = this.options.users.findById(userId);
      if (!user) throw new NotFoundError("User not found.", { userId });
      const existing = this.options.users.findByEmail(record.newEmail);
      if (existing && existing.id !== userId) {
        throw new ConflictError("An account with this email already exists.");
      }

      const updated = this.options.users.updateEmail(userId, record.newEmail, nowIso);
      this.options.emailChangeTokens.invalidateActiveForUser(userId, nowIso, nowIso);
      this.options.userSessions.revokeAllExcept(userId, currentSessionId, nowIso);
      return {
        oldEmail: user.email,
        displayName: user.displayName,
        updatedEmail: updated.email,
        emailVerifiedAt: updated.emailVerifiedAt ?? nowIso,
      };
    });

    try {
      await this.options.mailService.sendEmailChangedNotice({
        toEmail: completed.oldEmail,
        displayName: completed.displayName,
        newEmail: completed.updatedEmail,
      });
    } catch (error) {
      this.options.logger.error("email change notice delivery failed", {
        userId,
        toEmail: completed.oldEmail,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { email: completed.updatedEmail, emailVerifiedAt: completed.emailVerifiedAt };
  }

  cleanupExpiredAndRevoked(nowIso: string, retentionIso: string): number {
    return this.options.userSessions.cleanupExpiredAndRevoked(nowIso, retentionIso) +
      this.options.emailVerificationTokens.cleanupExpiredAndConsumed(nowIso, retentionIso) +
      this.options.passwordResetTokens.cleanupExpiredAndConsumed(nowIso, retentionIso) +
      this.options.emailChangeTokens.cleanupExpiredAndConsumed(nowIso, retentionIso);
  }

  private async prepareSessionDraft(
    remembered: boolean,
    deviceLabel: string | null,
  ): Promise<{
    sessionId: string;
    refreshToken: string;
    refreshTokenHash: string;
    remembered: boolean;
    deviceLabel: string | null;
    expiresAt: string;
  }> {
    const refreshToken = this.options.tokenService.generateRefreshToken();
    const refreshTokenHash = await this.options.tokenService.hashRefreshToken(refreshToken);
    const sessionId = generateId();
    const ttlMs = remembered
      ? this.options.sessionRememberedTtlMs
      : this.options.sessionDefaultTtlMs;
    return {
      sessionId,
      refreshToken,
      refreshTokenHash,
      remembered,
      deviceLabel,
      expiresAt: new Date(this.now() + ttlMs).toISOString(),
    };
  }

  private async buildAuthResult(
    user: User,
    session: {
      sessionId: string;
      refreshToken: string;
    },
  ): Promise<AuthResult> {
    const accessToken = await this.options.tokenService.signAccessToken(
      user.id,
      user.username,
      session.sessionId,
    );
    return { profile: toProfile(user), accessToken, refreshToken: session.refreshToken };
  }

  private async prepareOpaqueToken(
    ttlMs: number,
  ): Promise<{ id: string; rawToken: string; tokenHash: string; expiresAt: string }> {
    const rawToken = this.options.tokenService.generateOpaqueToken();
    const tokenHash = await this.options.tokenService.hashOpaqueToken(rawToken);
    return {
      id: generateId(),
      rawToken,
      tokenHash,
      expiresAt: new Date(this.now() + ttlMs).toISOString(),
    };
  }

  private buildPublicUrl(param: string, rawToken: string): string {
    const url = new URL(this.options.publicBaseUrl);
    url.searchParams.set(param, rawToken);
    return url.toString();
  }

  private async trySendVerificationEmail(user: User, rawToken: string): Promise<boolean> {
    try {
      await this.options.mailService.sendVerificationEmail({
        toEmail: user.email,
        displayName: user.displayName,
        verificationUrl: this.buildPublicUrl("verify_email", rawToken),
      });
      return true;
    } catch (error) {
      this.options.logger.error("verification mail delivery failed", {
        userId: user.id,
        toEmail: user.email,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async trySendPasswordChangedNotice(
    email: string,
    displayName: string,
  ): Promise<void> {
    try {
      await this.options.mailService.sendPasswordChangedNotice({
        toEmail: email,
        displayName,
      });
    } catch (error) {
      this.options.logger.error("password changed notice delivery failed", {
        toEmail: email,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async trySendPasswordResetEmail(user: User, rawToken: string): Promise<void> {
    try {
      await this.options.mailService.sendPasswordResetEmail({
        toEmail: user.email,
        displayName: user.displayName,
        resetUrl: this.buildPublicUrl("reset_password", rawToken),
      });
    } catch (error) {
      this.options.logger.error("password reset mail delivery failed", {
        userId: user.id,
        toEmail: user.email,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }
}
