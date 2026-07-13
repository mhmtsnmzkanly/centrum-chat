export type AppRole = "user" | "moderator" | "admin" | "owner";
export type ReportTargetType = "user" | "message" | "attachment";
export type ReportReason =
  | "spam"
  | "harassment"
  | "threats"
  | "impersonation"
  | "sexual_content"
  | "illegal_content"
  | "privacy"
  | "other";
export type ReportStatus = "open" | "in_review" | "resolved" | "dismissed";
export type SanctionType =
  | "message_mute"
  | "interaction_restriction"
  | "account_suspension";

export const REPORT_REASONS: readonly ReportReason[] = [
  "spam",
  "harassment",
  "threats",
  "impersonation",
  "sexual_content",
  "illegal_content",
  "privacy",
  "other",
];
export const REPORT_STATUSES: readonly ReportStatus[] = [
  "open",
  "in_review",
  "resolved",
  "dismissed",
];
export const SANCTION_TYPES: readonly SanctionType[] = [
  "message_mute",
  "interaction_restriction",
  "account_suspension",
];

export interface BlockedUser {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly createdAt: string;
}

export interface ReportRecord {
  readonly id: string;
  readonly reporterUserId: string;
  readonly targetType: ReportTargetType;
  readonly targetId: string;
  readonly reasonCode: ReportReason;
  readonly details: string | null;
  readonly status: ReportStatus;
  readonly assignedModeratorId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resolvedAt: string | null;
}

export interface SanctionRecord {
  readonly id: string;
  readonly userId: string;
  readonly type: SanctionType;
  readonly reasonCode: string;
  readonly moderatorNote: string | null;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly startsAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly revokedByUserId: string | null;
  readonly revokeReason: string | null;
}

export interface AuditEventRecord {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly actorType: AppRole | "system";
  readonly actionCode: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly outcome: "success" | "denied" | "failure";
  readonly metadata: Record<string, string | number | boolean | null>;
  readonly createdAt: string;
}

export interface ModerationMessageSnapshot {
  readonly id: string;
  readonly conversationId: string;
  readonly authorId: string | null;
  readonly content: string;
  readonly createdAt: string;
  readonly deletedAt: string | null;
}

export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}
