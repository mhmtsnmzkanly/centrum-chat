import type { Db } from "../db.ts";
import type {
  EmailChangeTokenRecord,
  EmailChangeTokenRepository,
  NewEmailChangeToken,
} from "../../domain/auth/emailChangeTokenRepository.port.ts";

interface EmailChangeTokenRow {
  id: string;
  user_id: string;
  new_email: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

function toRecord(row: EmailChangeTokenRow): EmailChangeTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    newEmail: row.new_email,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

export class SqliteEmailChangeTokenRepository implements EmailChangeTokenRepository {
  constructor(private readonly db: Db) {}

  create(token: NewEmailChangeToken): EmailChangeTokenRecord {
    this.db.prepare(
      `INSERT INTO email_change_tokens (id, user_id, new_email, token_hash, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(token.id, token.userId, token.newEmail, token.tokenHash, token.expiresAt);
    const row = this.db.prepare("SELECT * FROM email_change_tokens WHERE id = ?").get(
      token.id,
    ) as EmailChangeTokenRow | undefined;
    if (!row) throw new Error("Failed to read back newly created email change token.");
    return toRecord(row);
  }

  invalidateActiveForUser(userId: string, consumedAt: string, nowIso: string): number {
    const result = this.db.prepare(
      `UPDATE email_change_tokens
       SET consumed_at = ?
       WHERE user_id = ? AND consumed_at IS NULL AND expires_at >= ?`,
    ).run(consumedAt, userId, nowIso);
    return Number(result.changes);
  }

  findActiveByUserAndTokenHash(
    userId: string,
    tokenHash: string,
    nowIso: string,
  ): EmailChangeTokenRecord | null {
    const row = this.db.prepare(
      `SELECT * FROM email_change_tokens
       WHERE user_id = ? AND token_hash = ? AND consumed_at IS NULL AND expires_at >= ?`,
    ).get(userId, tokenHash, nowIso) as EmailChangeTokenRow | undefined;
    return row ? toRecord(row) : null;
  }

  findLatestActiveForUser(userId: string, nowIso: string): EmailChangeTokenRecord | null {
    const row = this.db.prepare(
      `SELECT * FROM email_change_tokens
       WHERE user_id = ? AND consumed_at IS NULL AND expires_at >= ?
       ORDER BY created_at DESC LIMIT 1`,
    ).get(userId, nowIso) as EmailChangeTokenRow | undefined;
    return row ? toRecord(row) : null;
  }

  consume(id: string, consumedAt: string): boolean {
    const result = this.db.prepare(
      `UPDATE email_change_tokens SET consumed_at = ?
       WHERE id = ? AND consumed_at IS NULL`,
    ).run(consumedAt, id);
    return Number(result.changes) === 1;
  }

  cleanupExpiredAndConsumed(nowIso: string, consumedBeforeIso: string): number {
    const result = this.db.prepare(
      `DELETE FROM email_change_tokens
       WHERE expires_at < ?
          OR (consumed_at IS NOT NULL AND consumed_at < ?)`,
    ).run(nowIso, consumedBeforeIso);
    return Number(result.changes);
  }
}
