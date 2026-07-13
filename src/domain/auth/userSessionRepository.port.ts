export interface UserSessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly refreshTokenHash: string;
  readonly deviceLabel: string | null;
  readonly remembered: boolean;
  readonly issuedAt: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

export interface NewUserSession {
  readonly id: string;
  readonly userId: string;
  readonly refreshTokenHash: string;
  readonly deviceLabel: string | null;
  readonly remembered: boolean;
  /** ISO 8601 timestamp; absolute expiry is computed by AuthService, not the repository. */
  readonly expiresAt: string;
}

export interface ListedUserSession {
  readonly id: string;
  readonly deviceLabel: string | null;
  readonly remembered: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string;
}

/** Port implemented by `storage/repositories/sqliteUserSessionRepository.ts`. */
export interface UserSessionRepository {
  create(token: NewUserSession): UserSessionRecord;
  findById(id: string): UserSessionRecord | null;
  findByRefreshTokenHash(refreshTokenHash: string): UserSessionRecord | null;
  /** Atomically replaces the refresh-token hash for an active unexpired session while
   * preserving the session id and absolute expiry. Returns the updated record when this
   * call won the compare-and-swap, otherwise null. */
  rotate(
    id: string,
    currentRefreshTokenHash: string,
    nextRefreshTokenHash: string,
    lastUsedAt: string,
    nowIso: string,
  ): UserSessionRecord | null;
  revoke(id: string): boolean;
  revokeOwnedSession(userId: string, id: string, revokedAt: string): boolean;
  revokeAllForUser(userId: string, revokedAt: string): number;
  revokeAllExcept(userId: string, keepSessionId: string, revokedAt: string): number;
  listActiveForUser(userId: string, nowIso: string): ListedUserSession[];
  cleanupExpiredAndRevoked(nowIso: string, revokedBeforeIso: string): number;
}
