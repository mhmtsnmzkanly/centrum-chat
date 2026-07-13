import type { TransactionManager } from "../../shared/transactions/transactionManager.ts";
import type { UserRepository } from "../users/userRepository.port.ts";
import type { MessageRepository } from "../messages/messageRepository.port.ts";
import type { AttachmentRepository } from "../attachments/attachmentRepository.port.ts";
import type { ConversationRepository } from "../conversations/conversationRepository.port.ts";
import type { PermissionService } from "../permissions/permissionService.ts";
import type { AuditFilters, ReportFilters, SafetyRepository } from "./safetyRepository.port.ts";
import type {
  AppRole,
  AuditEventRecord,
  CursorPage,
  ReportReason,
  ReportRecord,
  ReportStatus,
  ReportTargetType,
  SanctionRecord,
  SanctionType,
} from "./safety.entity.ts";
import { BlockPolicy, ModerationPolicy, SanctionPolicy } from "./safetyPolicy.ts";
import { ConflictError } from "../../shared/errors/conflictError.ts";
import { NotFoundError } from "../../shared/errors/notFoundError.ts";
import { ForbiddenError } from "../../shared/errors/forbiddenError.ts";
import { ValidationError } from "../../shared/errors/validationError.ts";
import { generateId } from "../../shared/id.ts";
import { toUserSummary } from "../users/user.entity.ts";
import type { AdministrationPermissionService } from "../administration/permissionRegistry.ts";
import type { Permission } from "../administration/administration.entity.ts";

const TRANSITIONS: Readonly<Record<ReportStatus, readonly ReportStatus[]>> = {
  open: ["in_review", "dismissed"],
  in_review: ["open", "resolved", "dismissed"],
  resolved: [],
  dismissed: [],
};
const SENSITIVE_AUDIT_KEYS = new Set([
  "password",
  "authorization",
  "accessToken",
  "refreshToken",
  "token",
  "content",
]);

export interface SafetyServiceOptions {
  readonly safety: SafetyRepository;
  readonly users: UserRepository;
  readonly messages: MessageRepository;
  readonly attachments: AttachmentRepository;
  readonly conversations: ConversationRepository;
  readonly permissions: PermissionService;
  readonly transactions: TransactionManager;
  readonly onAccountSuspended?: (userId: string) => void;
  readonly administrationPermissions?: AdministrationPermissionService;
  readonly now?: () => number;
}

export class SafetyService {
  readonly blocks: BlockPolicy;
  readonly moderation: ModerationPolicy;
  readonly sanctions: SanctionPolicy;
  private readonly now: () => number;

  constructor(private readonly options: SafetyServiceOptions) {
    this.blocks = new BlockPolicy(options.safety);
    this.moderation = new ModerationPolicy(options.safety);
    this.now = options.now ?? (() => Date.now());
    this.sanctions = new SanctionPolicy(options.safety, this.now);
  }

  block(actorUserId: string, targetUserId: string): { blocked: true } {
    if (actorUserId === targetUserId) throw new ValidationError("A user cannot block themselves.");
    if (!this.options.users.findById(targetUserId)) throw new NotFoundError("User not found.");
    this.options.transactions.run(() => this.options.safety.addBlock(actorUserId, targetUserId));
    return { blocked: true };
  }

  unblock(actorUserId: string, targetUserId: string): { blocked: false } {
    this.options.transactions.run(() => this.options.safety.removeBlock(actorUserId, targetUserId));
    return { blocked: false };
  }

  listBlocked(userId: string, cursor: string | null, limit: number) {
    return this.options.safety.listBlocked(userId, cursor, limit);
  }

  createReport(
    reporterUserId: string,
    targetType: ReportTargetType,
    targetId: string,
    reasonCode: ReportReason,
    details: string | null,
  ): ReportRecord {
    this.requireReportTarget(reporterUserId, targetType, targetId);
    return this.options.safety.createReport({
      id: generateId(),
      reporterUserId,
      targetType,
      targetId,
      reasonCode,
      details,
    });
  }

  listReports(
    actorUserId: string,
    filters: ReportFilters,
    cursor: string | null,
    limit: number,
  ): CursorPage<ReportRecord> {
    this.requirePermission(actorUserId, "moderation.reports.view", "reports.list");
    return this.options.safety.listReports(filters, cursor, limit);
  }

  getReport(actorUserId: string, reportId: string): ReportRecord {
    this.requirePermission(actorUserId, "moderation.reports.view", "report.get");
    const report = this.options.safety.findReportById(reportId);
    if (!report) throw new NotFoundError("Report not found.");
    return report;
  }

  getReportContext(actorUserId: string, reportId: string, before: number, after: number) {
    const actorRole = this.requirePermission(
      actorUserId,
      "moderation.context.view",
      "report.context",
    );
    const report = this.options.safety.findReportById(reportId);
    if (!report) throw new NotFoundError("Report not found.");
    const targetUser = report.targetType === "user"
      ? this.options.users.findById(report.targetId)
      : null;
    const targetMessage = report.targetType === "message"
      ? this.options.messages.findById(report.targetId)
      : null;
    const targetAttachment = report.targetType === "attachment"
      ? this.options.attachments.findById(report.targetId)
      : null;
    const target = targetUser ?? targetMessage ?? targetAttachment;
    const context = report.targetType === "message"
      ? this.options.safety.getMessageContext(report.targetId, before, after)
      : [];
    const reportedUser = targetUser ? toUserSummary(targetUser) : null;
    const sanctions = report.targetType === "user"
      ? this.options.safety.listActiveSanctions(report.targetId, this.nowIso())
      : [];
    this.audit(actorUserId, actorRole, "report.context.view", "report", reportId, "success", {
      targetType: report.targetType,
      contextCount: context.length,
    });
    if (!target) throw new NotFoundError("Report target is unavailable.");
    if (report.targetType === "user") {
      return {
        report,
        target: reportedUser,
        context,
        reportedUser,
        sanctions,
      };
    }
    if (report.targetType === "attachment") {
      const attachment = targetAttachment!;
      return {
        report,
        target: {
          id: attachment.id,
          messageId: attachment.messageId,
          uploaderId: attachment.uploaderId,
          kind: attachment.kind,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
        },
        context,
        reportedUser,
        sanctions,
      };
    }
    return { report, target, context, reportedUser, sanctions };
  }

  assignReport(
    actorUserId: string,
    reportId: string,
    expectedAssigneeId: string | null,
    requestedAssigneeId: string | null,
  ): ReportRecord {
    const role = this.requirePermission(actorUserId, "moderation.reports.assign", "report.assign");
    const canAssignOthers = role === "admin" || role === "owner";
    const assigneeId = canAssignOthers && requestedAssigneeId ? requestedAssigneeId : actorUserId;
    if (!canAssignOthers && requestedAssigneeId && requestedAssigneeId !== actorUserId) {
      throw new ForbiddenError("Moderators may assign reports only to themselves.");
    }
    const assigneeRole = this.options.safety.getUserRole(assigneeId);
    if (
      assigneeRole !== "moderator" && assigneeRole !== "admin" && assigneeRole !== "owner"
    ) {
      throw new ValidationError("Assignee must be a moderator or administrator.");
    }
    const report = this.options.safety.assignReport(
      reportId,
      expectedAssigneeId,
      assigneeId,
      canAssignOthers,
    );
    if (!report) throw new ConflictError("Report assignment changed concurrently.");
    this.audit(actorUserId, role, "report.assign", "report", reportId, "success", { assigneeId });
    return report;
  }

  transitionReport(
    actorUserId: string,
    reportId: string,
    expectedStatus: ReportStatus,
    nextStatus: ReportStatus,
  ): ReportRecord {
    const role = this.requirePermission(
      actorUserId,
      "moderation.reports.transition",
      "report.transition",
    );
    if (!TRANSITIONS[expectedStatus].includes(nextStatus)) {
      throw new ValidationError("This report status transition is not allowed.");
    }
    const report = this.options.safety.transitionReport(
      reportId,
      expectedStatus,
      nextStatus,
      this.nowIso(),
    );
    if (!report) throw new ConflictError("Report status changed concurrently.");
    this.audit(actorUserId, role, "report.status.transition", "report", reportId, "success", {
      expectedStatus,
      nextStatus,
    });
    return report;
  }

  applySanction(
    actorUserId: string,
    targetUserId: string,
    type: SanctionType,
    reasonCode: string,
    moderatorNote: string | null,
    startsAt: string | null,
    expiresAt: string | null,
  ): SanctionRecord {
    const permission: Permission = type === "message_mute"
      ? "moderation.sanctions.message_mute"
      : type === "interaction_restriction"
      ? "moderation.sanctions.interaction_restriction"
      : "moderation.sanctions.account_suspension";
    const role = this.requirePermission(actorUserId, permission, "sanction.apply");
    if (!this.options.users.findById(targetUserId)) throw new NotFoundError("User not found.");
    const targetRole = this.options.safety.getUserRole(targetUserId);
    if (actorUserId === targetUserId) {
      throw new ForbiddenError("Moderators cannot sanction themselves.");
    }
    if (role === "moderator" && targetRole !== "user") {
      throw new ForbiddenError("Moderators may sanction only normal users.");
    }
    if (type === "account_suspension" && role !== "admin" && role !== "owner") {
      throw new ForbiddenError("Only administrators may suspend accounts.");
    }
    const startMs = startsAt === null ? this.now() : Date.parse(startsAt);
    const expiryMs = expiresAt === null ? null : Date.parse(expiresAt);
    if (!Number.isFinite(startMs) || (expiryMs !== null && !Number.isFinite(expiryMs))) {
      throw new ValidationError("Sanction timestamps must be valid ISO dates.");
    }
    if (type === "account_suspension" && startMs > this.now()) {
      throw new ValidationError("Account suspensions must start immediately.");
    }
    if (role === "moderator") {
      if (expiryMs === null) {
        throw new ValidationError("Moderator sanctions must have an expiry.");
      }
      if (expiryMs - startMs > 30 * 24 * 60 * 60 * 1000) {
        throw new ValidationError("Moderator sanctions may not exceed 30 days.");
      }
    }
    const start = new Date(startMs).toISOString();
    const normalizedExpiry = expiryMs === null ? null : new Date(expiryMs).toISOString();
    if (normalizedExpiry && normalizedExpiry <= start) {
      throw new ValidationError("Sanction expiry must be after its start.");
    }
    const sanction = this.options.safety.createSanction({
      id: generateId(),
      userId: targetUserId,
      type,
      reasonCode,
      moderatorNote,
      createdByUserId: actorUserId,
      startsAt: start,
      expiresAt: normalizedExpiry,
    });
    this.audit(actorUserId, role, "sanction.apply", "user", targetUserId, "success", {
      sanctionId: sanction.id,
      sanctionType: type,
    });
    if (type === "account_suspension" && start <= this.nowIso()) {
      this.options.onAccountSuspended?.(targetUserId);
    }
    return sanction;
  }

  revokeSanction(actorUserId: string, sanctionId: string, reason: string | null): SanctionRecord {
    const role = this.requirePermission(
      actorUserId,
      "moderation.sanctions.revoke",
      "sanction.revoke",
    );
    const existing = this.options.safety.findSanctionById(sanctionId);
    if (!existing) throw new NotFoundError("Sanction not found.");
    if (existing.type === "account_suspension" && role !== "admin" && role !== "owner") {
      throw new ForbiddenError("Only administrators may revoke account suspensions.");
    }
    const revoked = this.options.safety.revokeSanction(
      sanctionId,
      actorUserId,
      reason,
      this.nowIso(),
    );
    if (!revoked) throw new ConflictError("Sanction was already revoked.");
    this.audit(actorUserId, role, "sanction.revoke", "sanction", sanctionId, "success", {});
    return revoked;
  }

  listSanctions(
    actorUserId: string,
    targetUserId: string,
    activeOnly: boolean,
    cursor: string | null,
    limit: number,
  ) {
    this.requirePermission(actorUserId, "moderation.reports.view", "sanctions.list");
    return this.options.safety.listSanctions(
      targetUserId,
      activeOnly,
      this.nowIso(),
      cursor,
      limit,
    );
  }

  listAudit(
    actorUserId: string,
    filters: AuditFilters,
    cursor: string | null,
    limit: number,
  ): CursorPage<AuditEventRecord> {
    this.requirePermission(actorUserId, "admin.audit.view", "audit.list");
    return this.options.safety.listAudit(filters, cursor, limit);
  }

  auditCaptchaFailure(action: string, clientIp: string): void {
    this.audit(null, "system", "captcha.verify", "captcha_action", action, "denied", {
      action,
      clientIp,
    });
  }

  private requireModerator(userId: string, operation: string): AppRole {
    try {
      return this.moderation.requireModerator(userId);
    } catch (error) {
      const actorRole = this.options.safety.getUserRole(userId);
      this.audit(
        actorRole === null ? null : userId,
        actorRole ?? "user",
        "moderation.authorization",
        null,
        null,
        "denied",
        { operation },
      );
      throw error;
    }
  }

  private requirePermission(userId: string, permission: Permission, operation: string): AppRole {
    if (!this.options.administrationPermissions) return this.requireModerator(userId, operation);
    try {
      return this.options.administrationPermissions.require(userId, permission);
    } catch (error) {
      const actorRole = this.options.safety.getUserRole(userId);
      this.audit(
        actorRole === null ? null : userId,
        actorRole ?? "user",
        "moderation.authorization",
        null,
        null,
        "denied",
        { operation, permission },
      );
      throw error;
    }
  }

  private requireAdmin(userId: string, operation: string): "admin" | "owner" {
    try {
      return this.moderation.requireAdmin(userId);
    } catch (error) {
      const actorType = this.options.safety.getUserRole(userId) ?? "user";
      this.audit(
        this.options.safety.getUserRole(userId) === null ? null : userId,
        actorType,
        "admin.authorization",
        null,
        null,
        "denied",
        { operation },
      );
      throw error;
    }
  }

  private requireReportTarget(
    reporterUserId: string,
    targetType: ReportTargetType,
    targetId: string,
  ): void {
    if (targetType === "user") {
      const user = this.options.users.findById(targetId);
      if (!user || user.id === reporterUserId) throw new NotFoundError("Report target not found.");
      return;
    }
    if (targetType === "message") {
      const message = this.options.messages.findById(targetId);
      const conversation = message
        ? this.options.conversations.findById(message.conversationId)
        : null;
      if (
        !message || !conversation ||
        !this.options.permissions.canAccessRoom(conversation, reporterUserId)
      ) {
        throw new NotFoundError("Report target not found.");
      }
      return;
    }
    const attachment = this.options.attachments.findById(targetId);
    if (!attachment) throw new NotFoundError("Report target not found.");
    if (!attachment.messageId) {
      if (attachment.uploaderId !== reporterUserId) {
        throw new NotFoundError("Report target not found.");
      }
      return;
    }
    const message = this.options.messages.findById(attachment.messageId);
    const conversation = message
      ? this.options.conversations.findById(message.conversationId)
      : null;
    if (
      !message || !conversation ||
      !this.options.permissions.canAccessRoom(conversation, reporterUserId)
    ) {
      throw new NotFoundError("Report target not found.");
    }
  }

  private audit(
    actorUserId: string | null,
    actorType: AppRole | "system",
    actionCode: string,
    targetType: string | null,
    targetId: string | null,
    outcome: "success" | "denied" | "failure",
    metadata: Record<string, string | number | boolean | null>,
  ): void {
    const safeMetadata: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(metadata).slice(0, 16)) {
      if (SENSITIVE_AUDIT_KEYS.has(key)) continue;
      safeMetadata[key] = typeof value === "string" ? value.slice(0, 128) : value;
    }
    this.options.safety.appendAudit({
      id: generateId(),
      actorUserId,
      actorType,
      actionCode,
      targetType,
      targetId,
      outcome,
      metadata: safeMetadata,
    });
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }
}
