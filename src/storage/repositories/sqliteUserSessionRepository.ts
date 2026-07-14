import type { Db } from "../db.ts";
import type {
  ListedUserSession,
  NewUserSession,
  SessionClientMetadata,
  UserSessionRecord,
  UserSessionRepository,
} from "../../domain/auth/userSessionRepository.port.ts";

interface RefreshTokenRow {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  device_label: string | null;
  remembered: number;
  issued_at: string;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
}

function toRecord(row: RefreshTokenRow): UserSessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    refreshTokenHash: row.refresh_token_hash,
    deviceLabel: row.device_label,
    remembered: row.remembered === 1,
    issuedAt: row.issued_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  };
}

function toListedSession(row: RefreshTokenRow): ListedUserSession {
  return {
    id: row.id,
    deviceLabel: row.device_label,
    remembered: row.remembered === 1,
    createdAt: row.issued_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    revokedAt: row.revoked_at,
  };
}

/** All SQL for `user_sessions` lives here — no SQL outside `storage/repositories/**`. */
export class SqliteUserSessionRepository implements UserSessionRepository {
  constructor(private readonly db: Db) {}

  create(token: NewUserSession): UserSessionRecord {
    this.db.prepare(
      `INSERT INTO user_sessions (
         id, user_id, refresh_token_hash, device_label, remembered, last_used_at, expires_at,
         ip_address, user_agent
       )
       VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, ?, ?)`,
    ).run(
      token.id,
      token.userId,
      token.refreshTokenHash,
      token.deviceLabel,
      token.remembered ? 1 : 0,
      token.expiresAt,
      token.ipAddress ?? null,
      token.userAgent ?? null,
    );

    const row = this.db.prepare("SELECT * FROM user_sessions WHERE id = ?").get(token.id) as
      | RefreshTokenRow
      | undefined;
    if (!row) throw new Error("Failed to read back newly created refresh token.");
    return toRecord(row);
  }

  findById(id: string): UserSessionRecord | null {
    const row = this.db.prepare("SELECT * FROM user_sessions WHERE id = ?").get(id) as
      | RefreshTokenRow
      | undefined;
    return row ? toRecord(row) : null;
  }

  findByRefreshTokenHash(refreshTokenHash: string): UserSessionRecord | null {
    const row = this.db.prepare("SELECT * FROM user_sessions WHERE refresh_token_hash = ?").get(
      refreshTokenHash,
    ) as RefreshTokenRow | undefined;
    return row ? toRecord(row) : null;
  }

  rotate(
    id: string,
    currentRefreshTokenHash: string,
    nextRefreshTokenHash: string,
    lastUsedAt: string,
    nowIso: string,
    client?: SessionClientMetadata,
  ): UserSessionRecord | null {
    const result = this.db.prepare(
      `UPDATE user_sessions
       SET refresh_token_hash = ?, last_used_at = ?,
           ip_address = COALESCE(?, ip_address),
           user_agent = COALESCE(?, user_agent)
       WHERE id = ?
         AND refresh_token_hash = ?
         AND revoked_at IS NULL
         AND expires_at >= ?`,
    ).run(
      nextRefreshTokenHash,
      lastUsedAt,
      client?.ipAddress ?? null,
      client?.userAgent ?? null,
      id,
      currentRefreshTokenHash,
      nowIso,
    );
    if (Number(result.changes) !== 1) return null;
    return this.findById(id);
  }

  revoke(id: string): boolean {
    const result = this.db.prepare(
      `UPDATE user_sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND revoked_at IS NULL`,
    ).run(id);
    return Number(result.changes) === 1;
  }

  revokeOwnedSession(userId: string, id: string, revokedAt: string): boolean {
    const result = this.db.prepare(
      `UPDATE user_sessions SET revoked_at = ?
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    ).run(revokedAt, id, userId);
    return Number(result.changes) === 1;
  }

  revokeAllForUser(userId: string, revokedAt: string): number {
    const result = this.db.prepare(
      `UPDATE user_sessions SET revoked_at = ?
       WHERE user_id = ? AND revoked_at IS NULL`,
    ).run(revokedAt, userId);
    return Number(result.changes);
  }

  revokeAllExcept(userId: string, keepSessionId: string, revokedAt: string): number {
    const result = this.db.prepare(
      `UPDATE user_sessions SET revoked_at = ?
       WHERE user_id = ? AND id != ? AND revoked_at IS NULL`,
    ).run(revokedAt, userId, keepSessionId);
    return Number(result.changes);
  }

  listForUser(userId: string, nowIso: string): ListedUserSession[] {
    const rows = this.db.prepare(
      `SELECT * FROM user_sessions
       WHERE user_id = ? AND expires_at >= ?
       ORDER BY
         revoked_at IS NOT NULL,
         CASE WHEN last_used_at IS NULL THEN issued_at ELSE last_used_at END DESC,
         issued_at DESC`,
    ).all(userId, nowIso) as unknown as RefreshTokenRow[];
    return rows.map(toListedSession);
  }

  cleanupExpiredAndRevoked(nowIso: string, revokedBeforeIso: string): number {
    const result = this.db.prepare(
      `DELETE FROM user_sessions
       WHERE expires_at < ?
          OR (revoked_at IS NOT NULL AND revoked_at < ?)`,
    ).run(nowIso, revokedBeforeIso);
    return Number(result.changes);
  }
}
