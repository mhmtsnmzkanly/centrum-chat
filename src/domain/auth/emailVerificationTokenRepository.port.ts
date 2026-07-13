export interface EmailVerificationTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly createdAt: string;
}

export interface NewEmailVerificationToken {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: string;
}

export interface EmailVerificationTokenRepository {
  create(token: NewEmailVerificationToken): EmailVerificationTokenRecord;
  invalidateActiveForUser(userId: string, consumedAt: string, nowIso: string): number;
  findActiveByTokenHash(tokenHash: string, nowIso: string): EmailVerificationTokenRecord | null;
  consume(id: string, consumedAt: string): boolean;
  cleanupExpiredAndConsumed(nowIso: string, consumedBeforeIso: string): number;
}
