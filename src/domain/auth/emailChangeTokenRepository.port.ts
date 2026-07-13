export interface EmailChangeTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly newEmail: string;
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly createdAt: string;
}

export interface NewEmailChangeToken {
  readonly id: string;
  readonly userId: string;
  readonly newEmail: string;
  readonly tokenHash: string;
  readonly expiresAt: string;
}

export interface EmailChangeTokenRepository {
  create(token: NewEmailChangeToken): EmailChangeTokenRecord;
  invalidateActiveForUser(userId: string, consumedAt: string, nowIso: string): number;
  findActiveByUserAndTokenHash(
    userId: string,
    tokenHash: string,
    nowIso: string,
  ): EmailChangeTokenRecord | null;
  findLatestActiveForUser(userId: string, nowIso: string): EmailChangeTokenRecord | null;
  consume(id: string, consumedAt: string): boolean;
  cleanupExpiredAndConsumed(nowIso: string, consumedBeforeIso: string): number;
}
