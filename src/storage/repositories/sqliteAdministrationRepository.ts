import type { Db } from "../db.ts";
import { escapeLikePattern } from "../sqlLike.ts";
import type {
  AdminChannel,
  AdminUser,
  CursorPage,
  SettingKey,
  SettingRecord,
  SettingValue,
  SystemRole,
} from "../../domain/administration/administration.entity.ts";
import type {
  AdministrationRepository,
  AdminUserFilters,
} from "../../domain/administration/administrationRepository.port.ts";
import { ConflictError } from "../../shared/errors/conflictError.ts";

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string;
  email_verified_at: string | null;
  system_role: SystemRole;
  bio: string;
  avatar_url: string | null;
  cover_url: string | null;
  must_reset_password: number;
  account_disabled_at: string | null;
  suspended: number;
  created_at: string;
  updated_at: string;
  admin_version: number;
}
interface ChannelRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  is_public: number;
  sort_order: number;
  lifecycle_state: "active" | "archived";
  created_at: string;
  updated_at: string;
  admin_version: number;
}
interface SettingRow {
  key: SettingKey;
  value_json: string;
  value_type: "boolean" | "integer" | "string";
  version: number;
  updated_by_user_id: string | null;
  updated_at: string;
}

function user(row: UserRow): AdminUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    emailVerifiedAt: row.email_verified_at,
    role: row.system_role,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    coverUrl: row.cover_url,
    mustResetPassword: row.must_reset_password === 1,
    accountDisabledAt: row.account_disabled_at,
    suspended: row.suspended === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.admin_version,
  };
}
function channel(row: ChannelRow): AdminChannel {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isPublic: row.is_public === 1,
    sortOrder: row.sort_order,
    state: row.lifecycle_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.admin_version,
  };
}
function setting(row: SettingRow): SettingRecord {
  return {
    key: row.key,
    value: JSON.parse(row.value_json) as SettingValue,
    type: row.value_type,
    version: row.version,
    updatedByUserId: row.updated_by_user_id,
    updatedAt: row.updated_at,
  };
}
function page<T>(rows: T[], limit: number, id: (value: T) => string): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? id(items[items.length - 1]!) : null };
}

export class SqliteAdministrationRepository implements AdministrationRepository {
  constructor(private readonly db: Db) {}

  getRole(userId: string): SystemRole | null {
    const row = this.db.prepare("SELECT system_role FROM users WHERE id=?").get(userId) as {
      system_role: SystemRole;
    } | undefined;
    return row?.system_role ?? null;
  }
  setRoleByEmailIfNoOwner(email: string, role: "owner"): boolean {
    const result = this.db.prepare(
      "UPDATE users SET system_role=?,admin_version=admin_version+1 WHERE email=? AND NOT EXISTS (SELECT 1 FROM users WHERE system_role='owner')",
    ).run(role, email);
    return Number(result.changes) === 1;
  }
  countOwners(): number {
    return Number(
      (this.db.prepare(
        "SELECT COUNT(*) count FROM users WHERE system_role='owner'",
      ).get() as { count: number }).count,
    );
  }
  compareAndSetRole(userId: string, expected: SystemRole, next: SystemRole): boolean {
    const result = this.db.prepare(
      "UPDATE users SET system_role=?,admin_version=admin_version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND system_role=?",
    ).run(next, userId, expected);
    return Number(result.changes) === 1;
  }
  transferOwnership(
    actorId: string,
    targetId: string,
    expectedActor: SystemRole,
    expectedTarget: SystemRole,
  ): boolean {
    const target = this.db.prepare(
      "UPDATE users SET system_role='owner',admin_version=admin_version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND system_role=?",
    ).run(targetId, expectedTarget);
    if (Number(target.changes) !== 1) return false;
    const actor = this.db.prepare(
      "UPDATE users SET system_role='admin',admin_version=admin_version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND system_role=?",
    ).run(actorId, expectedActor);
    if (Number(actor.changes) !== 1) throw new Error("Ownership actor changed concurrently.");
    return true;
  }
  listUsers(
    filters: AdminUserFilters,
    cursor: string | null,
    limit: number,
    nowIso: string,
  ): CursorPage<AdminUser> {
    const search = filters.search ? `%${escapeLikePattern(filters.search)}%` : null;
    const rows = this.db.prepare(
      `SELECT u.*,
       EXISTS(SELECT 1 FROM user_sanctions s WHERE s.user_id=u.id
         AND s.sanction_type='account_suspension' AND s.revoked_at IS NULL
         AND s.starts_at<=? AND (s.expires_at IS NULL OR s.expires_at>?)) suspended
       FROM users u WHERE
       (? IS NULL OR u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')
       AND (? IS NULL OR u.system_role=?)
       AND (? IS NULL OR (u.email_verified_at IS NOT NULL)=?)
       AND (? IS NULL OR (u.account_disabled_at IS NOT NULL)=?)
       AND (? IS NULL OR EXISTS(SELECT 1 FROM user_sanctions sx WHERE sx.user_id=u.id
         AND sx.sanction_type='account_suspension' AND sx.revoked_at IS NULL
         AND sx.starts_at<=? AND (sx.expires_at IS NULL OR sx.expires_at>?))=?)
       AND (? IS NULL OR (u.created_at,u.id)<(SELECT created_at,id FROM users WHERE id=?))
       ORDER BY u.created_at DESC,u.id DESC LIMIT ?`,
    ).all(
      nowIso,
      nowIso,
      search,
      search,
      search,
      search,
      filters.role ?? null,
      filters.role ?? null,
      filters.verified === undefined ? null : 1,
      filters.verified ? 1 : 0,
      filters.disabled === undefined ? null : 1,
      filters.disabled ? 1 : 0,
      filters.suspended === undefined ? null : 1,
      nowIso,
      nowIso,
      filters.suspended ? 1 : 0,
      cursor,
      cursor,
      limit + 1,
    ) as unknown as UserRow[];
    return page(rows.map(user), limit, (item) => item.id);
  }
  findAdminUser(id: string, nowIso: string): AdminUser | null {
    const row = this.db.prepare(
      `SELECT u.*,EXISTS(SELECT 1 FROM user_sanctions s WHERE s.user_id=u.id
       AND s.sanction_type='account_suspension' AND s.revoked_at IS NULL
       AND s.starts_at<=? AND (s.expires_at IS NULL OR s.expires_at>?)) suspended
       FROM users u WHERE u.id=?`,
    ).get(nowIso, nowIso, id) as UserRow | undefined;
    return row ? user(row) : null;
  }
  updateUser(
    id: string,
    expectedVersion: number,
    patch: { displayName?: string; bio?: string; disabledAt?: string | null },
  ): AdminUser | null {
    const result = this.db.prepare(
      `UPDATE users SET display_name=COALESCE(?,display_name),bio=COALESCE(?,bio),
       account_disabled_at=CASE WHEN ?=1 THEN ? ELSE account_disabled_at END,
       admin_version=admin_version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id=? AND admin_version=?`,
    ).run(
      patch.displayName ?? null,
      patch.bio ?? null,
      "disabledAt" in patch ? 1 : 0,
      patch.disabledAt ?? null,
      id,
      expectedVersion,
    );
    return Number(result.changes) === 1 ? this.findAdminUser(id, new Date().toISOString()) : null;
  }
  setMustResetPassword(id: string, value: boolean): boolean {
    const result = this.db.prepare(
      "UPDATE users SET must_reset_password=?,admin_version=admin_version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    ).run(value ? 1 : 0, id);
    return Number(result.changes) === 1;
  }
  resetAvatar(id: string): string | null | undefined {
    const current = this.db.prepare("SELECT avatar_url FROM users WHERE id=?").get(id) as
      | { avatar_url: string | null }
      | undefined;
    if (!current) return undefined;
    this.db.prepare(
      "UPDATE users SET avatar_url=NULL,avatar_seed=NULL,admin_version=admin_version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    ).run(id);
    return current.avatar_url;
  }
  resetCover(id: string): string | null | undefined {
    const current = this.db.prepare("SELECT cover_url FROM users WHERE id=?").get(id) as
      | { cover_url: string | null }
      | undefined;
    if (!current) return undefined;
    this.db.prepare(
      "UPDATE users SET cover_url=NULL,cover_index=0,admin_version=admin_version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    ).run(id);
    return current.cover_url;
  }
  listChannels(
    state: "active" | "archived" | null,
    cursor: string | null,
    limit: number,
  ): CursorPage<AdminChannel> {
    const rows = this.db.prepare(
      `SELECT * FROM conversations WHERE type='channel' AND (? IS NULL OR lifecycle_state=?)
       AND (? IS NULL OR (sort_order,created_at,id)>
         (SELECT sort_order,created_at,id FROM conversations WHERE id=? AND type='channel'))
       ORDER BY sort_order,created_at,id LIMIT ?`,
    ).all(state, state, cursor, cursor, limit + 1) as unknown as ChannelRow[];
    return page(rows.map(channel), limit, (item) => item.id);
  }
  findAdminChannel(id: string): AdminChannel | null {
    const row = this.db.prepare(
      "SELECT * FROM conversations WHERE id=? AND type='channel'",
    ).get(id) as ChannelRow | undefined;
    return row ? channel(row) : null;
  }
  createChannel(input: {
    id: string;
    slug: string;
    name: string;
    description: string;
    sortOrder: number;
  }): AdminChannel {
    try {
      this.db.prepare(
        `INSERT INTO conversations
         (id,type,slug,name,topic,description,is_public,sort_order,lifecycle_state,updated_at)
         VALUES (?,'channel',?,?,?,?,1,?,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      ).run(
        input.id,
        input.slug,
        input.name,
        input.description,
        input.description,
        input.sortOrder,
      );
    } catch (error) {
      if (String(error).includes("UNIQUE constraint failed")) {
        throw new ConflictError("A channel with this slug already exists.");
      }
      throw error;
    }
    return this.findAdminChannel(input.id)!;
  }
  updateChannel(
    id: string,
    expectedVersion: number,
    patch: { name?: string; description?: string; sortOrder?: number },
  ): AdminChannel | null {
    const result = this.db.prepare(
      `UPDATE conversations SET name=COALESCE(?,name),
       description=COALESCE(?,description),topic=COALESCE(?,topic),
       sort_order=COALESCE(?,sort_order),
       admin_version=admin_version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id=? AND type='channel' AND admin_version=?`,
    ).run(
      patch.name ?? null,
      patch.description ?? null,
      patch.description ?? null,
      patch.sortOrder ?? null,
      id,
      expectedVersion,
    );
    return Number(result.changes) === 1 ? this.findAdminChannel(id) : null;
  }
  setChannelState(
    id: string,
    expectedVersion: number,
    expectedState: "active" | "archived",
    nextState: "active" | "archived",
  ): AdminChannel | null {
    const result = this.db.prepare(
      `UPDATE conversations SET lifecycle_state=?,admin_version=admin_version+1,
       updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id=? AND type='channel' AND admin_version=? AND lifecycle_state=?`,
    ).run(nextState, id, expectedVersion, expectedState);
    return Number(result.changes) === 1 ? this.findAdminChannel(id) : null;
  }
  listSettings(): SettingRecord[] {
    return (this.db.prepare("SELECT * FROM system_settings ORDER BY key")
      .all() as unknown as SettingRow[])
      .map(setting);
  }
  findSetting(key: SettingKey): SettingRecord | null {
    const row = this.db.prepare("SELECT * FROM system_settings WHERE key=?").get(key) as
      | SettingRow
      | undefined;
    return row ? setting(row) : null;
  }
  updateSetting(
    key: SettingKey,
    expectedVersion: number,
    value: SettingValue,
    actorId: string,
  ): SettingRecord | null {
    const result = this.db.prepare(
      `UPDATE system_settings SET value_json=?,version=version+1,updated_by_user_id=?,
       updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key=? AND version=?`,
    ).run(JSON.stringify(value), actorId, key, expectedVersion);
    return Number(result.changes) === 1 ? this.findSetting(key) : null;
  }
}
