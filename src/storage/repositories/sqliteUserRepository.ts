import type { Db } from "../db.ts";
import type { User, UserStatus } from "../../domain/users/user.entity.ts";
import type {
  NewUser,
  ProfileUpdate,
  UserRepository,
} from "../../domain/users/userRepository.port.ts";
import { escapeLikePattern } from "../sqlLike.ts";
import { ConflictError } from "../../shared/errors/conflictError.ts";

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string;
  email_verified_at: string | null;
  system_role: "user" | "moderator" | "admin" | "owner";
  must_reset_password: number;
  account_disabled_at: string | null;
  admin_version: number;
  password_hash: string;
  bio: string;
  avatar_seed: string | null;
  avatar_url: string | null;
  cover_index: number;
  cover_url: string | null;
  name_color: string | null;
  status: string;
  last_seen_at: string | null;
  is_premium: number;
  messages_sent: number;
  reactions_added: number;
  replies_made: number;
  created_at: string;
  updated_at: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    emailVerifiedAt: row.email_verified_at,
    appRole: row.system_role,
    mustResetPassword: row.must_reset_password === 1,
    accountDisabledAt: row.account_disabled_at,
    adminVersion: row.admin_version,
    passwordHash: row.password_hash,
    bio: row.bio,
    avatarSeed: row.avatar_seed,
    avatarUrl: row.avatar_url,
    coverIndex: row.cover_index,
    coverUrl: row.cover_url,
    nameColor: row.name_color,
    status: row.status as UserStatus,
    lastSeenAt: row.last_seen_at,
    isPremium: row.is_premium === 1,
    messagesSent: row.messages_sent,
    reactionsAdded: row.reactions_added,
    repliesMade: row.replies_made,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** All SQL for `users` lives here — no SQL outside `storage/repositories/**` (architecture doc). */
export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  create(user: NewUser): User {
    try {
      this.db.prepare(
        `INSERT INTO users (id, username, display_name, email, password_hash)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(user.id, user.username, user.displayName, user.email, user.passwordHash);
    } catch (error) {
      throw this.translateUniqueConstraintError(error);
    }

    const created = this.findById(user.id);
    if (!created) throw new Error("Failed to read back newly created user.");
    return created;
  }

  /** `AuthService.register` already pre-checks email/username uniqueness, but that's a
   * check-then-act race under concurrent signups for the same email/username — this is
   * the actual, race-proof guarantee, turning the DB's UNIQUE violation into the same
   * `ConflictError` the pre-check throws instead of a raw error reaching the boundary
   * as `INTERNAL_ERROR`. */
  private translateUniqueConstraintError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("UNIQUE constraint failed")) {
      return error instanceof Error ? error : new Error(message);
    }
    if (message.includes("users.email")) {
      return new ConflictError("An account with this email already exists.");
    }
    if (message.includes("users.username")) {
      return new ConflictError("This username is already taken.");
    }
    return new ConflictError("A user with conflicting unique fields already exists.");
  }

  findById(id: string): User | null {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      | UserRow
      | undefined;
    return row ? toUser(row) : null;
  }

  findByEmail(email: string): User | null {
    const row = this.db.prepare("SELECT * FROM users WHERE email = ?").get(email) as
      | UserRow
      | undefined;
    return row ? toUser(row) : null;
  }

  findByUsername(username: string): User | null {
    const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
      | UserRow
      | undefined;
    return row ? toUser(row) : null;
  }

  update(id: string, patch: ProfileUpdate): User {
    this.db.prepare(
      `UPDATE users SET
         display_name = COALESCE(?, display_name),
         bio = COALESCE(?, bio),
         avatar_seed = COALESCE(?, avatar_seed),
         name_color = COALESCE(?, name_color),
         cover_index = COALESCE(?, cover_index),
         is_premium = COALESCE(?, is_premium),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
    ).run(
      patch.displayName ?? null,
      patch.bio ?? null,
      patch.avatarSeed ?? null,
      patch.nameColor ?? null,
      patch.coverIndex ?? null,
      patch.isPremium === undefined ? null : patch.isPremium ? 1 : 0,
      id,
    );

    const updated = this.findById(id);
    if (!updated) throw new Error("Failed to read back updated user.");
    return updated;
  }

  updateStatus(id: string, status: UserStatus, lastSeenAt?: string): void {
    this.db.prepare(
      `UPDATE users SET status = ?, last_seen_at = COALESCE(?, last_seen_at),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    ).run(status, lastSeenAt ?? null, id);
  }

  updateAvatarUrl(id: string, avatarUrl: string): User {
    this.db.prepare(
      `UPDATE users SET avatar_url = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
    ).run(avatarUrl, id);

    const updated = this.findById(id);
    if (!updated) throw new Error("Failed to read back updated user.");
    return updated;
  }

  updateCoverUrl(id: string, coverUrl: string): User {
    this.db.prepare(
      `UPDATE users SET cover_url = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
    ).run(coverUrl, id);

    const updated = this.findById(id);
    if (!updated) throw new Error("Failed to read back updated user.");
    return updated;
  }

  clearForcedPasswordReset(id: string): void {
    this.db.prepare(
      "UPDATE users SET must_reset_password=0,admin_version=admin_version+1 WHERE id=?",
    ).run(id);
  }

  updatePasswordHash(id: string, passwordHash: string): User {
    this.db.prepare(
      `UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
    ).run(passwordHash, id);

    const updated = this.findById(id);
    if (!updated) throw new Error("Failed to read back updated user.");
    return updated;
  }

  updatePasswordHashIfCurrent(
    id: string,
    currentPasswordHash: string,
    newPasswordHash: string,
  ): User | null {
    const result = this.db.prepare(
      `UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND password_hash = ?`,
    ).run(newPasswordHash, id, currentPasswordHash);
    if (Number(result.changes) !== 1) return null;
    return this.findById(id);
  }

  markEmailVerified(id: string, verifiedAt: string): User {
    this.db.prepare(
      `UPDATE users
       SET email_verified_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
    ).run(verifiedAt, id);

    const updated = this.findById(id);
    if (!updated) throw new Error("Failed to read back updated user.");
    return updated;
  }

  updateEmail(id: string, email: string, verifiedAt: string): User {
    try {
      this.db.prepare(
        `UPDATE users
         SET email = ?, email_verified_at = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`,
      ).run(email, verifiedAt, id);
    } catch (error) {
      throw this.translateUniqueConstraintError(error);
    }

    const updated = this.findById(id);
    if (!updated) throw new Error("Failed to read back updated user.");
    return updated;
  }

  search(query: string, limit: number): User[] {
    const pattern = `%${escapeLikePattern(query)}%`;
    const rows = this.db.prepare(
      `SELECT * FROM users WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\'
       ORDER BY username LIMIT ?`,
    ).all(pattern, pattern, limit) as unknown as UserRow[];
    return rows.map(toUser);
  }
}
