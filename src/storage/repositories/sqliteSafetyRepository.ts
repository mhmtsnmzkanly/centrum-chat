import type { Db } from "../db.ts";
import { ConflictError } from "../../shared/errors/conflictError.ts";
import type {
  AuditFilters,
  NewSanction,
  ReportFilters,
  SafetyRepository,
} from "../../domain/safety/safetyRepository.port.ts";
import type {
  AppRole,
  AuditEventRecord,
  BlockedUser,
  CursorPage,
  ModerationMessageSnapshot,
  ReportReason,
  ReportRecord,
  ReportStatus,
  ReportTargetType,
  SanctionRecord,
  SanctionType,
} from "../../domain/safety/safety.entity.ts";

interface ReportRow {
  id: string;
  reporter_user_id: string;
  target_type: ReportTargetType;
  target_reference_id: string;
  target_user_id: string | null;
  target_message_id: string | null;
  target_attachment_id: string | null;
  reason_code: ReportReason;
  details: string | null;
  status: ReportStatus;
  assigned_moderator_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}
interface SanctionRow {
  id: string;
  user_id: string;
  sanction_type: SanctionType;
  reason_code: string;
  moderator_note: string | null;
  created_by_user_id: string;
  created_at: string;
  starts_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  revoke_reason: string | null;
}
interface AuditRow {
  id: string;
  actor_user_id: string | null;
  actor_type: AppRole | "system";
  actor_system_role: AppRole | "system" | null;
  action_code: string;
  target_type: string | null;
  target_id: string | null;
  outcome: "success" | "denied" | "failure";
  metadata_json: string | null;
  created_at: string;
}

const REDACTED = "[REDACTED]";
const SENSITIVE_AUDIT_KEYS = new Set([
  "password",
  "currentpassword",
  "newpassword",
  "accesstoken",
  "refreshtoken",
  "refreshtokenhash",
  "authorization",
  "cookie",
  "verificationtoken",
  "resettoken",
  "tokenhash",
  "jwtsecret",
  "secret",
  "captchatoken",
  "content",
  "messagebody",
]);

function normalizeAuditKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function sanitizeAuditMetadata(
  metadata: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata).slice(0, 16)) {
    safe[key] = SENSITIVE_AUDIT_KEYS.has(normalizeAuditKey(key))
      ? REDACTED
      : typeof value === "string"
      ? value.slice(0, 128)
      : value;
  }
  return safe;
}

function toReport(row: ReportRow): ReportRecord {
  return {
    id: row.id,
    reporterUserId: row.reporter_user_id,
    targetType: row.target_type,
    targetId: row.target_reference_id,
    reasonCode: row.reason_code,
    details: row.details,
    status: row.status,
    assignedModeratorId: row.assigned_moderator_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}
function toSanction(row: SanctionRow): SanctionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.sanction_type,
    reasonCode: row.reason_code,
    moderatorNote: row.moderator_note,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedByUserId: row.revoked_by_user_id,
    revokeReason: row.revoke_reason,
  };
}
function toAudit(row: AuditRow): AuditEventRecord {
  let metadata: Record<string, string | number | boolean | null> = {};
  if (row.metadata_json) {
    try {
      metadata = JSON.parse(row.metadata_json);
    } catch {
      metadata = {};
    }
  }
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorType: row.actor_system_role ?? row.actor_type,
    actionCode: row.action_code,
    targetType: row.target_type,
    targetId: row.target_id,
    outcome: row.outcome,
    metadata,
    createdAt: row.created_at,
  };
}
function page<T>(rows: T[], limit: number, idOf: (row: T) => string): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? idOf(items[items.length - 1]!) : null };
}

export class SqliteSafetyRepository implements SafetyRepository {
  constructor(private readonly db: Db) {}

  getUserRole(userId: string): AppRole | null {
    const row = this.db.prepare("SELECT system_role FROM users WHERE id = ?").get(userId) as
      | { system_role: AppRole }
      | undefined;
    return row?.system_role ?? null;
  }
  setUserRoleByEmail(email: string, role: AppRole): boolean {
    const result = this.db.prepare("UPDATE users SET system_role = ? WHERE email = ?").run(
      role,
      email,
    );
    return Number(result.changes) === 1;
  }
  addBlock(blockerUserId: string, blockedUserId: string): boolean {
    const result = this.db.prepare(
      "INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
    ).run(blockerUserId, blockedUserId);
    return Number(result.changes) === 1;
  }
  removeBlock(blockerUserId: string, blockedUserId: string): boolean {
    const result = this.db.prepare(
      "DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?",
    ).run(blockerUserId, blockedUserId);
    return Number(result.changes) === 1;
  }
  hasBlockEitherDirection(firstUserId: string, secondUserId: string): boolean {
    return this.db.prepare(
      "SELECT 1 FROM user_blocks WHERE (blocker_user_id=? AND blocked_user_id=?) OR (blocker_user_id=? AND blocked_user_id=?) LIMIT 1",
    ).get(firstUserId, secondUserId, secondUserId, firstUserId) !== undefined;
  }
  listBlocked(userId: string, cursor: string | null, limit: number): CursorPage<BlockedUser> {
    const rows = this.db.prepare(
      "SELECT u.id user_id,u.username,u.display_name,u.avatar_url,b.created_at FROM user_blocks b JOIN users u ON u.id=b.blocked_user_id WHERE b.blocker_user_id=? AND (? IS NULL OR (b.created_at,b.blocked_user_id)<(SELECT created_at,blocked_user_id FROM user_blocks WHERE blocker_user_id=? AND blocked_user_id=?)) ORDER BY b.created_at DESC,b.blocked_user_id DESC LIMIT ?",
    ).all(userId, cursor, userId, cursor, limit + 1) as unknown as Array<{
      user_id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
      created_at: string;
    }>;
    return page(
      rows.map((row) => ({
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        createdAt: row.created_at,
      })),
      limit,
      (item) => item.userId,
    );
  }
  createReport(input: {
    id: string;
    reporterUserId: string;
    targetType: ReportTargetType;
    targetId: string;
    reasonCode: ReportReason;
    details: string | null;
  }): ReportRecord {
    try {
      this.db.prepare(
        "INSERT INTO reports (id,reporter_user_id,target_type,target_reference_id,target_user_id,target_message_id,target_attachment_id,reason_code,details) VALUES (?,?,?,?,?,?,?,?,?)",
      ).run(
        input.id,
        input.reporterUserId,
        input.targetType,
        input.targetId,
        input.targetType === "user" ? input.targetId : null,
        input.targetType === "message" ? input.targetId : null,
        input.targetType === "attachment" ? input.targetId : null,
        input.reasonCode,
        input.details,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("UNIQUE constraint failed")) {
        throw new ConflictError("An active report already exists for this target.");
      }
      throw error;
    }
    return this.findReportById(input.id)!;
  }
  findReportById(id: string): ReportRecord | null {
    const row = this.db.prepare("SELECT * FROM reports WHERE id=?").get(id) as
      | ReportRow
      | undefined;
    return row ? toReport(row) : null;
  }
  listReports(
    filters: ReportFilters,
    cursor: string | null,
    limit: number,
  ): CursorPage<ReportRecord> {
    const rows = this.db.prepare(
      "SELECT * FROM reports WHERE (? IS NULL OR status=?) AND (? IS NULL OR target_type=?) AND (? IS NULL OR assigned_moderator_id=?) AND (? IS NULL OR (created_at,id)<(SELECT created_at,id FROM reports WHERE id=?)) ORDER BY created_at DESC,id DESC LIMIT ?",
    ).all(
      filters.status ?? null,
      filters.status ?? null,
      filters.targetType ?? null,
      filters.targetType ?? null,
      filters.assignedModeratorId ?? null,
      filters.assignedModeratorId ?? null,
      cursor,
      cursor,
      limit + 1,
    ) as unknown as ReportRow[];
    return page(rows.map(toReport), limit, (item) => item.id);
  }
  assignReport(
    reportId: string,
    expectedAssigneeId: string | null,
    assigneeId: string,
    allowReassign: boolean,
  ): ReportRecord | null {
    const sql = allowReassign
      ? "UPDATE reports SET assigned_moderator_id=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND assigned_moderator_id IS ?"
      : "UPDATE reports SET assigned_moderator_id=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND assigned_moderator_id IS NULL";
    const args = allowReassign
      ? [assigneeId, reportId, expectedAssigneeId]
      : [assigneeId, reportId];
    const result = this.db.prepare(sql).run(...args);
    return Number(result.changes) === 1 ? this.findReportById(reportId) : null;
  }
  transitionReport(
    reportId: string,
    expectedStatus: ReportStatus,
    nextStatus: ReportStatus,
    nowIso: string,
  ): ReportRecord | null {
    const resolvedAt = nextStatus === "resolved" || nextStatus === "dismissed" ? nowIso : null;
    const result = this.db.prepare(
      "UPDATE reports SET status=?,updated_at=?,resolved_at=? WHERE id=? AND status=?",
    ).run(nextStatus, nowIso, resolvedAt, reportId, expectedStatus);
    return Number(result.changes) === 1 ? this.findReportById(reportId) : null;
  }
  getMessageContext(
    messageId: string,
    before: number,
    after: number,
  ): ModerationMessageSnapshot[] {
    const target = this.db.prepare(
      "SELECT id,conversation_id AS conversationId,author_id AS authorId,content,created_at AS createdAt,deleted_at AS deletedAt FROM messages WHERE id=?",
    ).get(messageId) as ModerationMessageSnapshot | undefined;
    if (!target) return [];
    const prior = this.db.prepare(
      "SELECT id,conversation_id AS conversationId,author_id AS authorId,content,created_at AS createdAt,deleted_at AS deletedAt FROM messages WHERE conversation_id=? AND (created_at,id)<(?,?) ORDER BY created_at DESC,id DESC LIMIT ?",
    ).all(
      target.conversationId,
      target.createdAt,
      messageId,
      before,
    ) as unknown as ModerationMessageSnapshot[];
    const current = target;
    const following = this.db.prepare(
      "SELECT id,conversation_id AS conversationId,author_id AS authorId,content,created_at AS createdAt,deleted_at AS deletedAt FROM messages WHERE conversation_id=? AND (created_at,id)>(?,?) ORDER BY created_at,id LIMIT ?",
    ).all(
      current.conversationId,
      current.createdAt,
      messageId,
      after,
    ) as unknown as ModerationMessageSnapshot[];
    return [...prior.reverse(), current, ...following];
  }
  createSanction(input: NewSanction): SanctionRecord {
    this.db.prepare(
      "INSERT INTO user_sanctions (id,user_id,sanction_type,reason_code,moderator_note,created_by_user_id,starts_at,expires_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      input.id,
      input.userId,
      input.type,
      input.reasonCode,
      input.moderatorNote,
      input.createdByUserId,
      input.startsAt,
      input.expiresAt,
    );
    return this.findSanctionById(input.id)!;
  }
  findSanctionById(id: string): SanctionRecord | null {
    const row = this.db.prepare("SELECT * FROM user_sanctions WHERE id=?").get(id) as
      | SanctionRow
      | undefined;
    return row ? toSanction(row) : null;
  }
  listSanctions(
    userId: string,
    activeOnly: boolean,
    nowIso: string,
    cursor: string | null,
    limit: number,
  ): CursorPage<SanctionRecord> {
    const rows = this.db.prepare(
      "SELECT * FROM user_sanctions WHERE user_id=? AND (?=0 OR (revoked_at IS NULL AND starts_at<=? AND (expires_at IS NULL OR expires_at>?))) AND (? IS NULL OR (created_at,id)<(SELECT created_at,id FROM user_sanctions WHERE id=?)) ORDER BY created_at DESC,id DESC LIMIT ?",
    ).all(
      userId,
      activeOnly ? 1 : 0,
      nowIso,
      nowIso,
      cursor,
      cursor,
      limit + 1,
    ) as unknown as SanctionRow[];
    return page(rows.map(toSanction), limit, (item) => item.id);
  }
  listActiveSanctions(userId: string, nowIso: string): SanctionRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM user_sanctions WHERE user_id=? AND revoked_at IS NULL AND starts_at<=? AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC",
    ).all(userId, nowIso, nowIso) as unknown as SanctionRow[];
    return rows.map(toSanction);
  }
  revokeSanction(
    id: string,
    actorUserId: string,
    reason: string | null,
    nowIso: string,
  ): SanctionRecord | null {
    const result = this.db.prepare(
      "UPDATE user_sanctions SET revoked_at=?,revoked_by_user_id=?,revoke_reason=? WHERE id=? AND revoked_at IS NULL",
    ).run(nowIso, actorUserId, reason, id);
    return Number(result.changes) === 1 ? this.findSanctionById(id) : null;
  }
  appendAudit(event: Omit<AuditEventRecord, "createdAt">): AuditEventRecord {
    const metadata = sanitizeAuditMetadata(event.metadata);
    const metadataJson = Object.keys(metadata).length ? JSON.stringify(metadata) : null;
    this.db.prepare(
      "INSERT INTO security_audit_events (id,actor_user_id,actor_type,actor_system_role,action_code,target_type,target_id,outcome,metadata_json) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(
      event.id,
      event.actorUserId,
      event.actorType === "owner" ? "admin" : event.actorType,
      event.actorType,
      event.actionCode,
      event.targetType,
      event.targetId,
      event.outcome,
      metadataJson,
    );
    const row = this.db.prepare("SELECT * FROM security_audit_events WHERE id=?").get(
      event.id,
    ) as unknown as AuditRow | undefined;
    if (!row) throw new Error("Failed to read back audit event.");
    return toAudit(row);
  }
  listAudit(
    filters: AuditFilters,
    cursor: string | null,
    limit: number,
  ): CursorPage<AuditEventRecord> {
    const rows = this.db.prepare(
      "SELECT * FROM security_audit_events WHERE (? IS NULL OR action_code=?) AND (? IS NULL OR actor_user_id=?) AND (? IS NULL OR target_type=?) AND (? IS NULL OR target_id=?) AND (? IS NULL OR (created_at,id)<(SELECT created_at,id FROM security_audit_events WHERE id=?)) ORDER BY created_at DESC,id DESC LIMIT ?",
    ).all(
      filters.actionCode ?? null,
      filters.actionCode ?? null,
      filters.actorUserId ?? null,
      filters.actorUserId ?? null,
      filters.targetType ?? null,
      filters.targetType ?? null,
      filters.targetId ?? null,
      filters.targetId ?? null,
      cursor,
      cursor,
      limit + 1,
    ) as unknown as AuditRow[];
    return page(rows.map(toAudit), limit, (item) => item.id);
  }
}
