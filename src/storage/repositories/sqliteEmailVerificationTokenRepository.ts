import type { Db } from "../db.ts";
import type {
  EmailVerificationTokenRecord,
  EmailVerificationTokenRepository,
  NewEmailVerificationToken,
} from "../../domain/auth/emailVerificationTokenRepository.port.ts";

interface EmailVerificationTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

function toRecord(row: EmailVerificationTokenRow): EmailVerificationTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

export class SqliteEmailVerificationTokenRepository implements EmailVerificationTokenRepository {
  constructor(private readonly db: Db) {}

  create(token: NewEmailVerificationToken): EmailVerificationTokenRecord {
    this.db.prepare(
      `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    ).run(token.id, token.userId, token.tokenHash, token.expiresAt);
    const row = this.db.prepare("SELECT * FROM email_verification_tokens WHERE id = ?").get(
      token.id,
    ) as EmailVerificationTokenRow | undefined;
    if (!row) throw new Error("Failed to read back newly created email verification token.");
    return toRecord(row);
  }

  invalidateActiveForUser(userId: string, consumedAt: string, nowIso: string): number {
    const result = this.db.prepare(
      `UPDATE email_verification_tokens
       SET consumed_at = ?
       WHERE user_id = ? AND consumed_at IS NULL AND expires_at >= ?`,
    ).run(consumedAt, userId, nowIso);
    return Number(result.changes);
  }

  findActiveByTokenHash(tokenHash: string, nowIso: string): EmailVerificationTokenRecord | null {
    const row = this.db.prepare(
      `SELECT * FROM email_verification_tokens
       WHERE token_hash = ? AND consumed_at IS NULL AND expires_at >= ?`,
    ).get(tokenHash, nowIso) as EmailVerificationTokenRow | undefined;
    return row ? toRecord(row) : null;
  }

  consume(id: string, consumedAt: string): boolean {
    const result = this.db.prepare(
      `UPDATE email_verification_tokens SET consumed_at = ?
       WHERE id = ? AND consumed_at IS NULL`,
    ).run(consumedAt, id);
    return Number(result.changes) === 1;
  }

  cleanupExpiredAndConsumed(nowIso: string, consumedBeforeIso: string): number {
    const result = this.db.prepare(
      `DELETE FROM email_verification_tokens
       WHERE expires_at < ?
          OR (consumed_at IS NOT NULL AND consumed_at < ?)`,
    ).run(nowIso, consumedBeforeIso);
    return Number(result.changes);
  }
}
