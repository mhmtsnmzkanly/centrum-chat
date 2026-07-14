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
  /** Client metadata captured at creation and refreshed on rotation (migration 0010).
   * Null for sessions created before the migration or without a known client. */
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

/** Client metadata observed on the request that created or rotated a session. */
export interface SessionClientMetadata {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface NewUserSession {
  readonly id: string;
  readonly userId: string;
  readonly refreshTokenHash: string;
  readonly deviceLabel: string | null;
  readonly remembered: boolean;
  /** ISO 8601 timestamp; absolute expiry is computed by AuthService, not the repository. */
  readonly expiresAt: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface ListedUserSession {
  readonly id: string;
  readonly deviceLabel: string | null;
  readonly remembered: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  /** Non-null for revoked sessions, which stay listed as history until the
   * cleanup job purges them (docs/04 "GET /api/auth/sessions"). */
  readonly revokedAt: string | null;
}

/** Port implemented by `storage/repositories/sqliteUserSessionRepository.ts`. */
export interface UserSessionRepository {
  create(token: NewUserSession): UserSessionRecord;
  findById(id: string): UserSessionRecord | null;
  findByRefreshTokenHash(refreshTokenHash: string): UserSessionRecord | null;
  /** Atomically replaces the refresh-token hash for an active unexpired session while
   * preserving the session id and absolute expiry. Returns the updated record when this
   * call won the compare-and-swap, otherwise null. When `client` is provided, its
   * non-null fields overwrite the stored client metadata. */
  rotate(
    id: string,
    currentRefreshTokenHash: string,
    nextRefreshTokenHash: string,
    lastUsedAt: string,
    nowIso: string,
    client?: SessionClientMetadata,
  ): UserSessionRecord | null;
  revoke(id: string): boolean;
  revokeOwnedSession(userId: string, id: string, revokedAt: string): boolean;
  revokeAllForUser(userId: string, revokedAt: string): number;
  revokeAllExcept(userId: string, keepSessionId: string, revokedAt: string): number;
  /** Unexpired sessions for the account-security screen: active ones plus
   * recently revoked ones (with `revokedAt` set) as client history. */
  listForUser(userId: string, nowIso: string): ListedUserSession[];
  cleanupExpiredAndRevoked(nowIso: string, revokedBeforeIso: string): number;
}
