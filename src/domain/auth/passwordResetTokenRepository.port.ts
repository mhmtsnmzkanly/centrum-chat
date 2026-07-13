export interface PasswordResetTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly createdAt: string;
}

export interface NewPasswordResetToken {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: string;
}

export interface PasswordResetTokenRepository {
  create(token: NewPasswordResetToken): PasswordResetTokenRecord;
  invalidateActiveForUser(userId: string, consumedAt: string, nowIso: string): number;
  findActiveByTokenHash(tokenHash: string, nowIso: string): PasswordResetTokenRecord | null;
  consume(id: string, consumedAt: string): boolean;
  cleanupExpiredAndConsumed(nowIso: string, consumedBeforeIso: string): number;
}
