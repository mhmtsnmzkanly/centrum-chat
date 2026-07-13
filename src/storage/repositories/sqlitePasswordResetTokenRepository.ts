import type { Db } from "../db.ts";
import type {
  NewPasswordResetToken,
  PasswordResetTokenRecord,
  PasswordResetTokenRepository,
} from "../../domain/auth/passwordResetTokenRepository.port.ts";

interface PasswordResetTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

function toRecord(row: PasswordResetTokenRow): PasswordResetTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

export class SqlitePasswordResetTokenRepository implements PasswordResetTokenRepository {
  constructor(private readonly db: Db) {}

  create(token: NewPasswordResetToken): PasswordResetTokenRecord {
    this.db.prepare(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    ).run(token.id, token.userId, token.tokenHash, token.expiresAt);
    const row = this.db.prepare("SELECT * FROM password_reset_tokens WHERE id = ?").get(
      token.id,
    ) as PasswordResetTokenRow | undefined;
    if (!row) throw new Error("Failed to read back newly created password reset token.");
    return toRecord(row);
  }

  invalidateActiveForUser(userId: string, consumedAt: string, nowIso: string): number {
    const result = this.db.prepare(
      `UPDATE password_reset_tokens
       SET consumed_at = ?
       WHERE user_id = ? AND consumed_at IS NULL AND expires_at >= ?`,
    ).run(consumedAt, userId, nowIso);
    return Number(result.changes);
  }

  findActiveByTokenHash(tokenHash: string, nowIso: string): PasswordResetTokenRecord | null {
    const row = this.db.prepare(
      `SELECT * FROM password_reset_tokens
       WHERE token_hash = ? AND consumed_at IS NULL AND expires_at >= ?`,
    ).get(tokenHash, nowIso) as PasswordResetTokenRow | undefined;
    return row ? toRecord(row) : null;
  }

  consume(id: string, consumedAt: string): boolean {
    const result = this.db.prepare(
      `UPDATE password_reset_tokens SET consumed_at = ?
       WHERE id = ? AND consumed_at IS NULL`,
    ).run(consumedAt, id);
    return Number(result.changes) === 1;
  }

  cleanupExpiredAndConsumed(nowIso: string, consumedBeforeIso: string): number {
    const result = this.db.prepare(
      `DELETE FROM password_reset_tokens
       WHERE expires_at < ?
          OR (consumed_at IS NOT NULL AND consumed_at < ?)`,
    ).run(nowIso, consumedBeforeIso);
    return Number(result.changes);
  }
}
