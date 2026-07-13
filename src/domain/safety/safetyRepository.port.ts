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
} from "./safety.entity.ts";

export interface ReportFilters {
  readonly status?: ReportStatus;
  readonly targetType?: ReportTargetType;
  readonly assignedModeratorId?: string;
}

export interface AuditFilters {
  readonly actionCode?: string;
  readonly actorUserId?: string;
  readonly targetType?: string;
  readonly targetId?: string;
}

export interface NewSanction {
  readonly id: string;
  readonly userId: string;
  readonly type: SanctionType;
  readonly reasonCode: string;
  readonly moderatorNote: string | null;
  readonly createdByUserId: string;
  readonly startsAt: string;
  readonly expiresAt: string | null;
}

export interface SafetyRepository {
  getUserRole(userId: string): AppRole | null;
  setUserRoleByEmail(email: string, role: AppRole): boolean;
  addBlock(blockerUserId: string, blockedUserId: string): boolean;
  removeBlock(blockerUserId: string, blockedUserId: string): boolean;
  hasBlockEitherDirection(firstUserId: string, secondUserId: string): boolean;
  listBlocked(userId: string, cursor: string | null, limit: number): CursorPage<BlockedUser>;
  createReport(input: {
    id: string;
    reporterUserId: string;
    targetType: ReportTargetType;
    targetId: string;
    reasonCode: ReportReason;
    details: string | null;
  }): ReportRecord;
  findReportById(id: string): ReportRecord | null;
  listReports(
    filters: ReportFilters,
    cursor: string | null,
    limit: number,
  ): CursorPage<ReportRecord>;
  assignReport(
    reportId: string,
    expectedAssigneeId: string | null,
    assigneeId: string,
    allowReassign: boolean,
  ): ReportRecord | null;
  transitionReport(
    reportId: string,
    expectedStatus: ReportStatus,
    nextStatus: ReportStatus,
    nowIso: string,
  ): ReportRecord | null;
  getMessageContext(
    messageId: string,
    before: number,
    after: number,
  ): ModerationMessageSnapshot[];
  createSanction(input: NewSanction): SanctionRecord;
  findSanctionById(id: string): SanctionRecord | null;
  listSanctions(
    userId: string,
    activeOnly: boolean,
    nowIso: string,
    cursor: string | null,
    limit: number,
  ): CursorPage<SanctionRecord>;
  listActiveSanctions(userId: string, nowIso: string): SanctionRecord[];
  revokeSanction(
    id: string,
    actorUserId: string,
    reason: string | null,
    nowIso: string,
  ): SanctionRecord | null;
  appendAudit(event: Omit<AuditEventRecord, "createdAt">): AuditEventRecord;
  listAudit(
    filters: AuditFilters,
    cursor: string | null,
    limit: number,
  ): CursorPage<AuditEventRecord>;
}
